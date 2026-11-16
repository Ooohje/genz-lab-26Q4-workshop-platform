-- =====================================================================
-- Gen Z Lab. 워크샵 플랫폼 — 발표 우수팀 투표
-- platform.sql 을 이미 실행한 프로젝트에 "추가로" 실행합니다.
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run 하세요. 여러 번 실행해도 안전합니다.
-- =====================================================================

-- 1) 메인 관제에 '우수팀 투표' 프로그램 추가 --------------------------------

alter table public.sessions drop constraint if exists sessions_program_check;
alter table public.sessions add  constraint sessions_program_check
  check (program in ('lobby', 'wordcloud', 'dinner', 'teamvote', 'end'));

-- 2) 투표 후보에서 빼는 조 (발표하지 않는 조) --------------------------------
--    관리 화면의 우수팀 투표 탭에서 조마다 켜고 끌 수 있습니다.

alter table public.teams add column if not exists votable boolean not null default true;
update public.teams set votable = false where name = 'Chief Crew';

-- 3) 투표 (한 사람 한 표, 다시 고를 수 있음) --------------------------------

create table if not exists public.team_votes (
  knox_id    text primary key references public.participants (knox_id) on delete cascade on update cascade,
  team_no    integer not null references public.teams (team_no) on delete cascade,
  updated_at timestamptz not null default now()
);

alter table public.team_votes enable row level security;
revoke all on public.team_votes from anon, authenticated;
grant  all on public.team_votes to service_role;

-- 4) 참여자용 함수 -------------------------------------------------------

-- 내가 고를 수 있는 조(본인 조와 후보에서 뺀 조는 제외)와 지금 내 표
create or replace function public.wc_teamvote_state(p_knox_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v text := lower(btrim(coalesce(p_knox_id, '')));
  p public.participants%rowtype;
  mine integer;
begin
  select * into p from public.participants where knox_id = v;
  if not found then
    raise exception '먼저 Knox ID로 입장해 주세요';
  end if;
  select tv.team_no into mine from public.team_votes tv where tv.knox_id = v;

  return jsonb_build_object(
    'vote', mine,
    'vote_name', (select t.name from public.teams t where t.team_no = mine),
    'candidates', coalesce((select jsonb_agg(jsonb_build_object('team_no', t.team_no, 'name', t.name) order by t.team_no)
                              from public.teams t
                             where t.votable and t.team_no is distinct from p.team_no), '[]'::jsonb)
  );
end;
$$;

-- 투표하기
create or replace function public.wc_teamvote(p_knox_id text, p_team_no integer)
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
    raise exception '먼저 Knox ID로 입장해 주세요';
  end if;
  if not exists (select 1 from public.teams t where t.team_no = p_team_no and t.votable) then
    raise exception '투표할 수 없는 조입니다';
  end if;
  if p.team_no is not null and p.team_no = p_team_no then
    raise exception '본인 조에는 투표할 수 없어요';
  end if;

  insert into public.team_votes (knox_id, team_no, updated_at)
  values (v, p_team_no, now())
  on conflict (knox_id) do update set team_no = excluded.team_no, updated_at = now();

  return public.wc_teamvote_state(v);
end;
$$;

revoke all on function public.wc_teamvote_state(text), public.wc_teamvote(text, integer) from public;
grant execute on function public.wc_teamvote_state(text), public.wc_teamvote(text, integer)
  to anon, authenticated, service_role;
