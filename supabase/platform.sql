-- =====================================================================
-- Gen Z Lab. 워크샵 플랫폼 — 참가자·조·프로그램 관제·석식 투표
-- schema.sql 을 이미 실행한 프로젝트에 "추가로" 실행합니다.
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run 하세요. 여러 번 실행해도 안전합니다.
-- =====================================================================

-- 1) 메인 관제: 지금 어떤 프로그램을 진행 중인지 ---------------------------
--    참여자 화면은 sessions 변경을 실시간으로 받아 해당 프로그램 화면으로 넘어갑니다.

alter table public.sessions add column if not exists program    text    not null default 'lobby';
alter table public.sessions add column if not exists notice     text;                       -- 모든 참여자 화면 위에 띄우는 공지
alter table public.sessions add column if not exists roster_rev integer not null default 0; -- 명단·조가 바뀔 때 1씩 증가 → 참여자 화면이 내 조를 다시 읽음

alter table public.sessions drop constraint if exists sessions_program_check;
alter table public.sessions add  constraint sessions_program_check
  check (program in ('lobby', 'wordcloud', 'dinner', 'end'));
-- 프로그램을 추가하려면: 위 목록, js/app.js 의 PROGRAMS, 관리 화면 버튼에 같은 이름을 넣습니다.

-- 2) 조와 참가자 ---------------------------------------------------------

create table if not exists public.teams (
  team_no integer primary key check (team_no between 1 and 99),
  name    text    not null
);

create table if not exists public.participants (
  knox_id          text primary key check (knox_id = lower(btrim(knox_id)) and char_length(knox_id) between 1 and 40),
  name             text not null check (char_length(btrim(name)) between 1 and 30),
  team_no          integer references public.teams (team_no) on delete set null,
  is_preregistered boolean not null default false,  -- 명단으로 올린 사람인지(현장에서 직접 들어온 사람은 false)
  joined_at        timestamptz,                      -- 처음 입장한 시각 (아직 안 들어왔으면 null)
  last_seen        timestamptz
);
create index if not exists participants_team_idx on public.participants (team_no);

-- 3) 석식 참석 투표 ------------------------------------------------------

create table if not exists public.dinner_rsvp (
  knox_id    text primary key references public.participants (knox_id) on delete cascade on update cascade,
  choice     text not null check (choice in ('yes', 'no')),
  updated_at timestamptz not null default now()
);

-- 4) 권한 ---------------------------------------------------------------
--    이름·Knox ID·석식 명단은 공개 키로 직접 읽을 수 없습니다(RLS 켜고 정책 없음).
--    참여자는 아래 함수로 "자기 것"만, 관리자는 Edge Function(admin)으로만 봅니다.

alter table public.teams        enable row level security;
alter table public.participants enable row level security;
alter table public.dinner_rsvp  enable row level security;

revoke all on public.teams, public.participants, public.dinner_rsvp from anon, authenticated;
grant  all on public.teams, public.participants, public.dinner_rsvp to service_role;

-- 5) 참여자용 함수 -------------------------------------------------------

-- 내 정보: 이름, 조, 같은 조 사람들, 석식 선택
create or replace function public.wc_me(p_knox_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v text := lower(btrim(coalesce(p_knox_id, '')));
  p public.participants%rowtype;
begin
  select * into p from public.participants where knox_id = v;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  update public.participants
     set last_seen = now(), joined_at = coalesce(joined_at, now())
   where knox_id = v;

  return jsonb_build_object(
    'found', true,
    'knox_id', p.knox_id,
    'name', p.name,
    'team_no', p.team_no,
    'team_name', (select t.name from public.teams t where t.team_no = p.team_no),
    'teammates', coalesce((select jsonb_agg(m.name order by m.name)
                             from public.participants m
                            where m.team_no = p.team_no and m.knox_id <> p.knox_id), '[]'::jsonb),
    'dinner', (select r.choice from public.dinner_rsvp r where r.knox_id = p.knox_id)
  );
end;
$$;

-- 입장: 명단에 있으면 바로, 없으면 이름을 받아 '조 미배정'으로 등록
create or replace function public.wc_enter(p_knox_id text, p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v text := lower(btrim(coalesce(p_knox_id, '')));
  n text := btrim(coalesce(p_name, ''));
begin
  if char_length(v) < 1 or char_length(v) > 40 then
    raise exception 'Knox ID를 확인해 주세요';
  end if;

  if not exists (select 1 from public.participants where knox_id = v) then
    if n = '' then
      return jsonb_build_object('found', false, 'needs_name', true);
    end if;
    if char_length(n) > 30 then
      raise exception '이름은 30자까지 적어 주세요';
    end if;
    insert into public.participants (knox_id, name, is_preregistered, joined_at, last_seen)
    values (v, n, false, now(), now());
  end if;

  return public.wc_me(v);
end;
$$;

-- 석식 참석/미참석 (다시 고를 수 있음)
create or replace function public.wc_dinner(p_knox_id text, p_choice text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v text := lower(btrim(coalesce(p_knox_id, '')));
begin
  if p_choice not in ('yes', 'no') then
    raise exception '선택 값이 올바르지 않습니다';
  end if;
  if not exists (select 1 from public.participants where knox_id = v) then
    raise exception '먼저 Knox ID로 입장해 주세요';
  end if;

  insert into public.dinner_rsvp (knox_id, choice, updated_at)
  values (v, p_choice, now())
  on conflict (knox_id) do update set choice = excluded.choice, updated_at = now();

  return jsonb_build_object('dinner', p_choice);
end;
$$;

revoke all on function public.wc_me(text), public.wc_enter(text, text), public.wc_dinner(text, text) from public;
grant execute on function public.wc_me(text), public.wc_enter(text, text), public.wc_dinner(text, text)
  to anon, authenticated, service_role;
