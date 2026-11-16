-- =====================================================================
-- Gen Z Lab. 워크샵 워드클라우드 — Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다(이미 있는 것은 건너뜁니다).
-- =====================================================================

-- 1) 테이블 -------------------------------------------------------------

create table if not exists public.sessions (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,                 -- 접속 코드 (주소의 ?s=코드)
  question      text not null default '' check (char_length(question) <= 100),
  is_open       boolean not null default true,        -- 열림/닫힘
  ai_status     text not null default 'idle'          -- idle | loading | done | error
                check (ai_status in ('idle', 'loading', 'done', 'error')),
  ai_groups     jsonb,                                -- AI가 묶은 대표 단어: [{label, count, members}]
  ai_updated_at timestamptz,
  rev           integer not null default 0,           -- 숨기기·초기화 때 1씩 증가 → 화면이 단어를 다시 불러옴
  created_at    timestamptz not null default now()
);

create table if not exists public.words (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  word       text not null check (char_length(btrim(word)) between 1 and 15),
  -- 정규화된 단어: 공백 제거 + 소문자. 같은 단어를 합칠 때 기준이 됩니다.
  normalized text generated always as (lower(regexp_replace(word, '\s+', '', 'g'))) stored,
  hidden     boolean not null default false,
  client_id  uuid not null,                           -- 브라우저마다 만든 임의 번호(익명). 참여 인원 집계용
  created_at timestamptz not null default now()
);

create index if not exists words_session_idx on public.words (session_id, created_at);
create index if not exists words_client_idx  on public.words (session_id, client_id);

-- 2) 입력 정리 + 도배 방지 트리거 ----------------------------------------
--    앞뒤 공백을 잘라 저장하고, 한 사람이 한 세션에 30개 넘게 보내지 못하게 합니다.

create or replace function public.words_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.word := btrim(new.word);
  if (select count(*) from public.words w
      where w.session_id = new.session_id and w.client_id = new.client_id) >= 30 then
    raise exception '단어는 한 사람당 30개까지 보낼 수 있어요';
  end if;
  return new;
end;
$$;

drop trigger if exists words_before_insert on public.words;
create trigger words_before_insert
  before insert on public.words
  for each row execute function public.words_before_insert();

-- 3) RLS ---------------------------------------------------------------
--    익명 사용자: sessions 읽기만 / words 읽기·추가만. 수정·삭제 정책은 만들지 않으므로 불가.

alter table public.sessions enable row level security;
alter table public.words    enable row level security;

drop policy if exists "sessions_read" on public.sessions;
create policy "sessions_read" on public.sessions
  for select to anon, authenticated
  using (true);

drop policy if exists "words_read" on public.words;
create policy "words_read" on public.words
  for select to anon, authenticated
  using (true);

drop policy if exists "words_insert_when_open" on public.words;
create policy "words_insert_when_open" on public.words
  for insert to anon, authenticated
  with check (
    hidden = false
    and exists (
      select 1 from public.sessions s
      where s.id = session_id and s.is_open
    )
  );

-- 4) 권한(GRANT) --------------------------------------------------------
--    프로젝트를 만들 때 "Automatically expose new tables"를 껐으므로 직접 줍니다.
--    익명 사용자는 words에 session_id·word·client_id 세 칸만 넣을 수 있습니다
--    (hidden, created_at 등은 직접 지정 불가).

grant usage on schema public to anon, authenticated, service_role;

revoke all on public.sessions from anon, authenticated;
revoke all on public.words    from anon, authenticated;

grant select on public.sessions to anon, authenticated;
grant select on public.words    to anon, authenticated;
grant insert (session_id, word, client_id) on public.words to anon, authenticated;

-- Edge Function(관리자 동작)이 쓰는 서버 전용 역할
grant all on public.sessions to service_role;
grant all on public.words    to service_role;

-- 5) Realtime ----------------------------------------------------------
--    words 추가와 sessions 변경을 실시간으로 내보냅니다.

do $$
begin
  begin
    alter publication supabase_realtime add table public.words;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.sessions;
  exception when duplicate_object then null;
  end;
end;
$$;

-- 6) 첫 세션 만들기 ------------------------------------------------------
--    접속 코드는 'genz'. 질문은 관리 화면에서 언제든 바꿀 수 있습니다.

insert into public.sessions (code, question)
values ('genz', '9기 Gen Z Lab. Crew가 된다면 더 해보고 싶은 활동을 자유롭게 말해주세요')
on conflict (code) do nothing;
