-- =====================================================================
-- Gen Z Lab. 워크샵 플랫폼 — 보스 레이드 (js/raid.js · 관리 화면 보스 레이드 탭)
-- 워크샵 플랫폼과 같은 Supabase 프로젝트에서 씁니다. platform.sql 을 실행한 뒤 이 파일을 SQL Editor 에 통째로 붙여 넣고 Run.
-- 명단: 진행자가 시뮬레이터에 명단을 따로 넣지 않으면 워크샵 명단(participants · teams, 관리 화면 '명단 · 조')을 그대로 씁니다(Chief Crew 조 제외).
--       참여자는 워크샵 참여 화면에 넣은 Knox ID 로 자동 입장합니다. 워크샵 명단이 비어 있으면 6자리(A조·B조 3명씩) 연습판입니다.
-- 메인 관제의 프로그램 목록에 'raid'(보스 레이드)를 더합니다(맨 아래).
-- 진행자 버튼은 Edge Function supabase/functions/raid-sim 이 비밀번호를 확인한 뒤 raid_sim_admin 을 부릅니다.
-- 여러 번 실행해도 안전합니다(진행 중인 연습 상태와 진행자 화면에서 고친 보스·규칙은 그대로 둡니다).
--
-- 판정은 스탯만으로 합니다.
--   캐릭터 스탯 5개: 체력(hp) · 지력(intel) · 친화력(social) · 멘탈(mental) · 운(luck)
--   공격력 = 판정 스탯 합 (+돌발 이벤트 주사위). 보스 HP 이상이면 격파 → 보상 점수.
--   돌발 이벤트 룰렛: 진행자가 정한 칸(config.roulette, 2~10칸) 중 하나. 칸 효과 kind: power(공격력 ±value) · clear(격파하면 +value점) · fail(실패해도 +value점) · none
--   운: 운이 높을수록 아래쪽 칸이 잘 나옵니다. k번째 칸의 가중치 = r^(k-1), r = (1 + luckPower/100)^t, t = (운 − 스탯 최소) / (스탯 최대 − 스탯 최소).
--   연습 라운드: 0번 라운드(config.practiceBoss). 룰렛은 항상 터지고, 출전 기록과 점수에는 들어가지 않습니다.
--   출전: 라운드마다 조에서 1명. 한 사람 최대 2번 (조원 6명 미만인 조는 3번), 입장한 조원이 모두 다 썼으면 가장 적게 나간 사람.
--   라운드 공격력 1위 조는 MVP 점수(mvpBonus). 순위는 총점, 같으면 격파 횟수, 그것도 같으면 같은 등수 (js/raid.js scoreboard).
-- 보스와 규칙은 진행자 화면의 "보스·규칙 설정" 탭에서 고칩니다.
-- =====================================================================

-- 1) 표 -----------------------------------------------------------------

-- 판정 스탯이 든 보스 표. 공개 키로는 읽을 수 없습니다.
create table if not exists public.raid_sim_bosses (
  round       smallint primary key check (round between 1 and 20),
  name        text     not null,
  description text     not null,
  hp          smallint not null,
  reward      smallint not null,
  has_event   boolean  not null default false,
  stats       text[]   not null,
  hint        text     not null default '',
  reveal      text     not null default ''
);
-- 돌발 이벤트 주사위 효과 (1이 나왔을 때 / 6이 나왔을 때 공격력 변화)
-- 보스는 20명까지 (예전에 10명으로 만든 표도 늘림)
alter table public.raid_sim_bosses drop constraint if exists raid_sim_bosses_round_check;
alter table public.raid_sim_bosses add  constraint raid_sim_bosses_round_check check (round between 1 and 20);
alter table public.raid_sim_bosses add column if not exists dice_low  smallint not null default -2;
alter table public.raid_sim_bosses add column if not exists dice_high smallint not null default 3;

-- 게임 규칙 (스탯 합계·범위, 외형 랜덤 뽑기, 시간, MVP, 운). 비어 있으면 raid_sim_default_config() 값.
create table if not exists public.raid_sim_config (
  id         smallint primary key default 1 check (id = 1),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 참여자 명단 [{uid, name, team}]. 비어 있으면 6자리(A조·B조 3명씩) 연습판. 공개 키로는 읽을 수 없습니다.
create table if not exists public.raid_sim_roster (
  id         smallint primary key default 1 check (id = 1),
  data       jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- 전체 진행 상태 (결과 공개 전의 공격력 포함). 공개 키로는 읽을 수 없습니다.
create table if not exists public.raid_sim_state (
  id         smallint primary key default 1 check (id = 1),
  state      jsonb not null,
  updated_at timestamptz not null default now()
);

-- 휴대폰·발표 화면이 실시간으로 받는 "공개해도 되는" 상태.
create table if not exists public.raid_sim_public (
  id         smallint primary key default 1 check (id = 1),
  data       jsonb   not null default '{}'::jsonb,
  rev        integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.raid_sim_bosses enable row level security;
alter table public.raid_sim_config enable row level security;
alter table public.raid_sim_roster enable row level security;
alter table public.raid_sim_state  enable row level security;
alter table public.raid_sim_public enable row level security;
revoke all on public.raid_sim_bosses, public.raid_sim_config, public.raid_sim_roster, public.raid_sim_state, public.raid_sim_public from anon, authenticated;
grant select on public.raid_sim_public to anon, authenticated;
drop policy if exists raid_sim_public_read on public.raid_sim_public;
create policy raid_sim_public_read on public.raid_sim_public for select to anon, authenticated using (true);

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'raid_sim_public') then
    alter publication supabase_realtime add table public.raid_sim_public;
  end if;
end $$;

-- 예전 버전의 진행자 함수 (인자 2개). 아래에서 설정 저장용 인자를 더한 새 함수로 바꿉니다.
drop function if exists public.raid_sim_admin(text, integer);

-- 2) 규칙 ----------------------------------------------------------------

create or replace function public.raid_sim_ms() returns bigint
language sql stable as $$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;

create or replace function public.raid_sim_keys() returns text[]
language sql immutable as $$ select array['hp', 'intel', 'social', 'mental', 'luck'] $$;

-- 기본 출전 보스 9명 (처음 설치 · "보스 기본값으로"). js/raid-sim-engine.js 의 DEFAULT_BOSSES 와 같음
create or replace function public.raid_sim_default_bosses() returns jsonb
language sql immutable as $$
  select '[
    {"name":"일요일 밤 메신저 ''혹시 지금 잠깐 돼요?''","desc":"일요일 저녁 9시, 침대에 누워 드라마를 보는데 휴대폰이 울린다. \"주말에 죄송한데 지난번 그 파일 어디 있었죠? 지금 바로 좀 알려 줘요.\" 읽음 표시가 뜨는 순간 주말은 끝난다.","hp":11,"reward":1,"event":false,"diceLow":-2,"diceHigh":3,"stats":["mental","luck"],"hint":"답장보다 중요한 건 내 주말을 지키는 마음.","reveal":"주말 메신저를 이긴 건 ''내일 아침에 확인할게요''를 보낼 수 있는 단단한 멘탈, 그리고 마침 휴대폰을 무음으로 해 둔 운이었습니다. 지력으로 파일 위치를 바로 찾아 줘도 다음 질문이 또 올 뿐이었어요."},
    {"name":"점심 5분 컷 ''다 먹었으면 일어나지?''","desc":"회의가 길어진 팀장님을 30분이나 기다려 겨우 같이 앉은 점심. 내 찌개가 나오자마자 팀장님이 숟가락을 내려놓는다. \"다 먹었지? 이제 슬슬 일어나자.\" 내 밥은 아직 반도 안 줄었다.","hp":11,"reward":1,"event":false,"diceLow":-2,"diceHigh":3,"stats":["hp","luck"],"hint":"빨리 먹거나, 빨리 나오거나.","reveal":"5분 점심을 이긴 건 뜨거운 찌개도 순식간에 비우는 체력, 그리고 주문한 메뉴가 제일 먼저 나오는 운이었습니다. 친화력으로 ''천천히 드세요''를 끌어내 보려 해도 팀장님은 이미 일어나 계셨어요."},
    {"name":"퇴근 붙잡기 ''에이~ 나도 약속 있어~''","desc":"\"오늘 저녁 약속이 있어서 먼저 들어가 보겠습니다.\" 가방을 메는 순간 선배가 웃으며 팔을 잡는다. \"에이~ 나도 약속 있는데~ 30분만 같이 보고 가자.\" 그 30분이 두 시간이 될 걸 우리는 안다.","hp":12,"reward":2,"event":false,"diceLow":-2,"diceHigh":3,"stats":["social","mental"],"hint":"웃으면서, 그러나 단호하게.","reveal":"약속을 지켜 낸 건 분위기를 해치지 않고 웃으며 빠져나오는 친화력, 그리고 ''그래도 가 보겠습니다''를 끝까지 말하는 멘탈이었습니다. 체력으로 두 시간을 버티면 약속도 일도 둘 다 놓쳤어요."},
    {"name":"칼퇴 상사 ''그럼 이것만 부탁해요~''","desc":"오후 5시 55분, 팀장님이 서류 뭉치를 책상에 내려놓는다. \"이거 내일 아침 회의 자료니까 정리 좀 부탁해요. 난 먼저 갈게, 수고~\" 엘리베이터 문이 닫히고 사무실에는 나와 서류만 남았다.","hp":12,"reward":2,"event":false,"diceLow":-2,"diceHigh":3,"stats":["hp","intel"],"hint":"빨리 끝내는 머리와 오래 버티는 몸.","reveal":"혼자 남은 밤을 이긴 건 서류 더미에서 꼭 필요한 것만 골라 정리하는 지력, 그리고 늦게까지 버틸 체력이었습니다. 멘탈로 억울함을 삭여 봐도 서류는 줄어들지 않았어요."},
    {"name":"우유부단 상사 ''음… 둘 다 괜찮은데?''","desc":"A안과 B안을 들고 간 지 벌써 세 번째. 팀장님은 한참을 들여다보다 말한다. \"음… 둘 다 괜찮은데? 조금만 더 고민해 보고 다시 얘기하죠.\" 마감은 내일인데 결정은 아직 아무도 안 했다.","hp":12,"reward":2,"event":true,"diceLow":-2,"diceHigh":3,"stats":["intel","luck"],"hint":"결국 누군가는 대신 골라 줘야 한다.","reveal":"결정을 끌어낸 건 선택지를 한 장으로 정리해 ''이걸로 가시죠''를 내미는 지력, 그리고 팀장님이 마침 그 안을 고르는 운이었습니다. 멘탈로 기다리기만 하면 고민은 다음 주까지 이어졌어요."},
    {"name":"답정너 ''이건 좀 아닌 것 같은데…''","desc":"보고서를 올릴 때마다 돌아오는 한마디. \"음… 이건 좀 아닌 것 같은데, 다시 해 와 봐요.\" 무엇이 정답인지는 말해 주지 않는다. 팀장님 머릿속에는 이미 답이 있는데, 그걸 맞힐 때까지 끝나지 않는다.","hp":13,"reward":3,"event":false,"diceLow":-2,"diceHigh":3,"stats":["intel","social"],"hint":"정답은 문서가 아니라 사람 마음속에 있다.","reveal":"답정너를 이긴 건 지난 피드백 속 단서로 숨은 답을 읽어 내는 지력, 그리고 ''혹시 이런 방향 말씀이세요?'' 하고 슬쩍 물어보는 친화력이었습니다. 체력으로 열 번 다시 해 가도 답을 모르면 열한 번째가 기다렸어요."},
    {"name":"밤 10시 ''번개 회식 가자!''","desc":"야근을 마치고 겨우 노트북을 덮은 밤 10시. 부장님이 외투를 챙기며 외친다. \"다들 고생했어! 간단하게 딱 한 잔만 하고 가자!\" 그 ''한 잔''이 새벽 1시까지 간다는 건 모두가 알고 있다.","hp":13,"reward":3,"event":true,"diceLow":-2,"diceHigh":3,"stats":["hp","social"],"hint":"피할 수 없다면, 웃으며 버텨라.","reveal":"늦은 번개 회식을 이긴 건 새벽까지 버티는 체력, 그리고 피곤한 와중에도 분위기를 살리는 친화력이었습니다. 지력으로 빠져나갈 핑계를 찾았을 때는 이미 2차 자리였어요."},
    {"name":"월요일 해외 출장 ''내일 출발 가능하죠?''","desc":"일요일 밤 11시, 메신저가 울린다. \"내일 월요일인데, 혹시 내일 해외 출장 갈 수 있나요? 비행기는 아침 7시예요.\" 짐도, 자료도, 마음의 준비도 하나도 안 돼 있다. 공항까지 남은 시간은 단 8시간.","hp":16,"reward":3,"event":true,"diceLow":-2,"diceHigh":3,"stats":["hp","mental","luck"],"hint":"밤새 짐 싸는 몸, 흔들리지 않는 마음, 그리고 남은 비행기 좌석.","reveal":"갑작스러운 출장을 이긴 건 밤새 짐을 꾸리고 새벽 공항까지 달려갈 체력, 당황하지 않고 하나씩 챙기는 멘탈, 그리고 마지막 남은 좌석을 잡는 운이었습니다. 이번만큼은 머리를 굴릴 시간조차 없었어요."},
    {"name":"최종 보스: ''1차, 2차, 3차… 피드백이 다 달라요''","desc":"1차 피드백: \"좀 더 화려하게.\" 2차 피드백: \"너무 화려한데? 심플하게.\" 3차 피드백: \"처음 버전이 제일 낫네요.\" 파일 이름은 어느새 ''최종_진짜최종_이게마지막''. 오늘 밤 4차 피드백이 온다.","hp":17,"reward":4,"event":true,"diceLow":-2,"diceHigh":3,"stats":["hp","intel","mental"],"hint":"모든 버전을 기억하는 사람이 마지막에 웃는다.","reveal":"바뀌는 피드백을 이긴 건 모든 버전과 말씀을 기록해 두고 근거로 내미는 지력, 몇 번을 뒤집혀도 무너지지 않는 멘탈, 그리고 끝까지 고쳐 내는 체력이었습니다. 친화력으로 웃어넘기기엔 피드백이 너무 많았어요."}
  ]'::jsonb
$$;

-- 기본 규칙. bossPool = 보스 목록 (기본 9명 + 예전 기본 보스 5명). 진행자가 이 중에서 출전 보스를 고릅니다.
create or replace function public.raid_sim_default_config() returns jsonb
language sql immutable as $$
  select '{"statTotal": 25, "statMin": 1, "statMax": 10, "rerolls": 2, "meetingSec": 180, "practiceMeetingSec": 60, "shareMin": 8, "mvpBonus": 1, "luckPower": 35,
           "roulette": [{"kind": "power", "value": -2}, {"kind": "power", "value": -1}, {"kind": "power", "value": 1},
                        {"kind": "clear", "value": 1}, {"kind": "fail", "value": 1}, {"kind": "power", "value": 3}],
           "practiceBoss": {"name": "연습 보스: 월요일 아침 ''만원 지하철''",
                            "desc": "월요일 아침 8시, 지하철 문이 열리자 사람들이 밀려든다. 손잡이 하나 잡기도 힘든 이 전쟁을 버텨야 회사에 도착한다. 연습 판이니 부담 없이 붙어 보자!",
                            "hp": 10, "stats": ["hp", "luck"], "hint": "버티거나, 운 좋게 앉거나.",
                            "reveal": "만원 지하철을 이긴 건 끝까지 서서 버티는 체력, 그리고 마침 앞자리가 비는 운이었습니다. 머리를 써도 지하철은 빨리 오지 않아요."},
           "joinShort": "", "lobbyTitle": "", "lobbySub": "", "rulesTitle": "", "rulesLines": [], "infoTitle": "", "infoSections": []}'::jsonb
    || jsonb_build_object('bossPool', public.raid_sim_default_bosses() || '[
    {"name":"무한 회의 루프 ''리:미팅''","desc":"회의가 끝나면 ''방금 회의를 정리하는 회의''가 소환된다. 벌써 세 번째 회의, 의자는 딱딱하고 결론은 또 다음 회의로 미뤄진다. 이 보스는 쓰러뜨리는 게 아니라 끝날 때까지 버텨야 사라진다.","hp":11,"reward":1,"event":false,"diceLow":-2,"diceHigh":3,"stats":["hp","mental"],"hint":"끝까지 남는 사람이 이긴다.","reveal":"끝없는 회의를 이긴 건 말솜씨가 아니라 버티는 힘이었습니다. 몇 시간째 이어지는 회의를 견딜 체력, 결론 없는 말들에 지치지 않을 멘탈이 필요했어요. 지력으로 정리해 보려 해도 회의는 또 다른 회의를 낳을 뿐이었습니다."},
    {"name":"알림 폭탄 ''안읽음 999+''","desc":"점심 먹고 왔더니 단톡방 9개에 안 읽은 메시지가 999개. 그 사이 어딘가에 팀장님의 \"이거 확인 가능?\"이 숨어 있다. 하나씩 다 읽다가는 퇴근 시간이 지나 버린다.","hp":12,"reward":2,"event":false,"diceLow":-2,"diceHigh":3,"stats":["intel","mental"],"hint":"999개를 다 읽을 필요는 없다.","reveal":"999개를 다 읽는 사람이 아니라 중요한 한 개를 골라내는 사람이 이겼습니다. 쏟아지는 알림 속에서 우선순위를 가려낼 지력, 빨간 숫자에 흔들리지 않을 멘탈이 핵심이었어요. 체력으로 하나하나 다 읽으면 오히려 늦었습니다."},
    {"name":"팀장님의 ''편하게 얘기해 봐요''","desc":"회의 끝 무렵, 팀장님이 웃으며 말한다. \"부담 갖지 말고 편하게 얘기해 봐요.\" 회의실에 정적이 흐르고 모두의 시선이 바닥으로 향한다. 침묵도 정답이 아니고, 아무 말이나 꺼내도 정답이 아니다.","hp":12,"reward":2,"event":false,"diceLow":-2,"diceHigh":3,"stats":["intel","social"],"hint":"아무 말도 안 하면 지고, 아무 말이나 해도 진다.","reveal":"할 말을 빠르게 정리하는 지력과, 그 말을 분위기에 맞게 꺼내는 친화력이 함께 필요했습니다. 정리만 하고 말을 못 꺼내면 침묵이 되고, 분위기만 읽고 내용이 없으면 공허한 말이 됐어요."},
    {"name":"금요일 17:58 ''긴급 수정 요청''","desc":"퇴근 2분 전 도착한 메일. 제목: [긴급] 최종_진짜최종_수정본 확인 부탁드립니다. 첨부 파일은 세 개, 수정 요청은 스무 군데. 금요일 저녁에는 무슨 일이 생길지 아무도 모른다.","hp":13,"reward":3,"event":true,"diceLow":-2,"diceHigh":3,"stats":["social","hp"],"hint":"혼자 하면 밤 10시, 같이 하면 7시.","reveal":"혼자 밤새 붙잡고 있기보다 동료를 불러 일을 나누는 게 정답이었습니다. 도움을 청하고 함께 움직일 친화력, 마지막 수정까지 밀어붙일 체력이 필요했어요. 금요일 저녁의 변수는 주사위가 정했습니다."},
    {"name":"최종 보스: 연말 회식 ''건배사 지명''","desc":"1차, 2차, 노래방까지 이어진 연말 회식. 자정 무렵 마이크가 나에게 넘어온다. \"자, 올해 마무리 한마디!\" 수십 명의 눈이 나만 보고 있고, 분위기는 이미 무르익었다.","hp":16,"reward":4,"event":true,"diceLow":-2,"diceHigh":3,"stats":["hp","social","mental"],"hint":"이 자리에서 머리를 쓰는 사람은 없다.","reveal":"자정까지 버틸 체력, 분위기를 읽고 사람들을 웃길 친화력, 수십 명 앞에서도 떨지 않을 멘탈이 모두 필요했습니다. 이 자리에서 머리를 굴리는 사람은 없었어요. 지력만 빠진 이유입니다."}
  ]'::jsonb)
$$;

create or replace function public.raid_sim_cfg() returns jsonb
language sql stable security definer set search_path = public as $$
  select public.raid_sim_default_config() || coalesce((select data from public.raid_sim_config where id = 1), '{}'::jsonb)
$$;

-- 정수인지, 범위 안인지 (문자열·소수는 거절)
create or replace function public.raid_sim_is_int(j jsonb, lo integer, hi integer) returns boolean
language sql immutable as $$
  select coalesce(jsonb_typeof(j) = 'number' and j::text ~ '^-?\d{1,4}$' and (j::text)::integer between lo and hi, false)
$$;

-- 규칙 확인. 문제가 없으면 null, 있으면 이유.
create or replace function public.raid_sim_check_config(c jsonb) returns text
language plpgsql immutable as $$
declare v_min integer; v_max integer; n integer := cardinality(public.raid_sim_keys());
begin
  if not public.raid_sim_is_int(c->'statMin', 1, 10) then return '스탯 최소는 1~10점이에요'; end if;
  v_min := (c->>'statMin')::integer;
  if not public.raid_sim_is_int(c->'statMax', v_min, 30) then return '스탯 최대는 최소 이상, 30점 이하예요'; end if;
  v_max := (c->>'statMax')::integer;
  if not public.raid_sim_is_int(c->'statTotal', n * v_min, n * v_max) then
    return '스탯 합계는 ' || (n * v_min) || '~' || (n * v_max) || '점이어야 해요 (스탯 ' || n || '개 × 최소~최대)';
  end if;
  if not public.raid_sim_is_int(c->'rerolls', 0, 10) then return '외형 랜덤 뽑기는 0~10번이에요'; end if;
  if not public.raid_sim_is_int(c->'meetingSec', 30, 1800) then return '회의 시간은 30~1800초예요'; end if;
  if not public.raid_sim_is_int(c->'practiceMeetingSec', 10, 1800) then return '연습 보스 회의 시간은 10~1800초예요'; end if;
  if not public.raid_sim_is_int(c->'shareMin', 1, 60) then return '조 내 공유 시간은 1~60분이에요'; end if;
  if not public.raid_sim_is_int(c->'mvpBonus', 0, 20) then return 'MVP 점수는 0~20점이에요'; end if;
  if not public.raid_sim_is_int(c->'luckPower', 0, 100) then return '운 효과 세기는 0~100이에요 (0이면 운과 상관없이 모든 칸이 같은 확률)'; end if;
  if jsonb_typeof(c->'joinShort') is distinct from 'string' or length(c->>'joinShort') > 100 or c->>'joinShort' ~ '\s' then
    return '짧은 참여 주소는 띄어쓰기 없이 100자까지예요';
  end if;
  if jsonb_typeof(c->'lobbyTitle') is distinct from 'string' or jsonb_typeof(c->'lobbySub') is distinct from 'string' or jsonb_typeof(c->'rulesTitle') is distinct from 'string'
     or length(c->>'lobbyTitle') > 200 or length(c->>'lobbySub') > 200 or length(c->>'rulesTitle') > 200 then return '화면 문구는 200자 이하예요'; end if;
  if jsonb_typeof(c->'rulesLines') is distinct from 'array' or jsonb_array_length(c->'rulesLines') > 12
     or exists (select 1 from jsonb_array_elements(c->'rulesLines') x where jsonb_typeof(x) <> 'string' or length(x #>> '{}') > 200) then
    return '규칙 줄은 12줄, 한 줄 200자까지예요';
  end if;
  if jsonb_typeof(c->'infoTitle') is distinct from 'string' or length(c->>'infoTitle') > 60 then return 'i 창 제목은 60자까지예요'; end if;
  if jsonb_typeof(c->'infoSections') is distinct from 'array' or jsonb_array_length(c->'infoSections') > 12
     or exists (select 1 from jsonb_array_elements(c->'infoSections') x
                where jsonb_typeof(x) <> 'object' or jsonb_typeof(x->'title') <> 'string' or jsonb_typeof(x->'body') <> 'string'
                   or length(btrim(x->>'title')) not between 1 and 40 or length(x->>'body') > 800) then
    return 'i 창은 12칸까지, 칸 제목 40자 · 내용 800자까지예요';
  end if;
  if jsonb_typeof(c->'roulette') is distinct from 'array' or jsonb_array_length(c->'roulette') not between 2 and 10 then return '룰렛 칸은 2~10개예요'; end if;
  if exists (select 1 from jsonb_array_elements(c->'roulette') x
             where jsonb_typeof(x) <> 'object' or coalesce(x->>'kind', '') not in ('power', 'clear', 'fail', 'none') or not public.raid_sim_is_int(x->'value', -50, 50)) then
    return '룰렛 칸의 효과 값은 -50~50이에요';
  end if;
  if jsonb_typeof(c->'bossPool') is distinct from 'array' or jsonb_array_length(c->'bossPool') > 30 then return '보스 목록은 30명까지예요'; end if;
  if jsonb_array_length(c->'bossPool') > 0 and public.raid_sim_check_bosses(c->'bossPool', 30) is not null then
    return '보스 목록 ' || public.raid_sim_check_bosses(c->'bossPool', 30);
  end if;
  if jsonb_typeof(c->'practiceBoss') is distinct from 'object' then return '연습 보스 형식이 잘못됐어요'; end if;
  return replace(public.raid_sim_check_bosses(jsonb_build_array(c->'practiceBoss' || '{"reward": 0, "event": true, "diceLow": 0, "diceHigh": 0}'::jsonb)), '1번 보스: ', '연습 보스: ');
end $$;

-- 보스 목록 확인. 문제가 없으면 null, 있으면 이유.
drop function if exists public.raid_sim_check_bosses(jsonb);
create or replace function public.raid_sim_check_bosses(p jsonb, p_max integer default 20) returns text
language plpgsql immutable as $$
declare v jsonb; i bigint; pre text; st text; seen text[];
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) not between 1 and p_max then return '보스는 1~' || p_max || '명이어야 해요'; end if;
  for v, i in select x.value, x.ord from jsonb_array_elements(p) with ordinality as x(value, ord) loop
    pre := i || '번 보스: ';
    if jsonb_typeof(v) is distinct from 'object' then return pre || '형식이 잘못됐어요'; end if;
    if jsonb_typeof(v->'name') is distinct from 'string' or btrim(v->>'name') = '' or length(v->>'name') > 60 then return pre || '이름은 1~60자로 적어 주세요'; end if;
    if jsonb_typeof(v->'desc') is distinct from 'string' or length(v->>'desc') > 300 then return pre || '설명은 300자 이하예요'; end if;
    if not public.raid_sim_is_int(v->'hp', 1, 300) then return pre || 'HP는 1~300이에요'; end if;
    if not public.raid_sim_is_int(v->'reward', 0, 50) then return pre || '보상 점수는 0~50점이에요'; end if;
    if jsonb_typeof(v->'event') is distinct from 'boolean' then return pre || '돌발 이벤트 값이 잘못됐어요'; end if;
    if not public.raid_sim_is_int(v->'diceLow', -50, 50) or not public.raid_sim_is_int(v->'diceHigh', -50, 50) then return pre || '주사위 효과는 -50~50이에요'; end if;
    if jsonb_typeof(v->'stats') is distinct from 'array' or jsonb_array_length(v->'stats') not between 1 and 5 then return pre || '판정 스탯을 1개 이상 골라 주세요'; end if;
    seen := '{}';
    for st in select jsonb_array_elements_text(v->'stats') loop
      if not (st = any (public.raid_sim_keys())) or st = any (seen) then return pre || '판정 스탯이 잘못됐어요'; end if;
      seen := seen || st;
    end loop;
    if jsonb_typeof(v->'hint') is distinct from 'string' or length(v->>'hint') > 200 then return pre || '힌트는 200자 이하예요'; end if;
    if jsonb_typeof(v->'reveal') is distinct from 'string' or length(v->>'reveal') > 300 then return pre || '공개 설명은 300자 이하예요'; end if;
  end loop;
  return null;
end $$;

-- 명단 확인. [{uid, name, team}] (빈 배열 = 6자리 연습판으로). 문제가 없으면 null, 있으면 이유.
create or replace function public.raid_sim_check_roster(p jsonb) returns text
language plpgsql immutable as $$
declare v jsonb; i bigint; pre text; u text; t text; v_uids text[] := '{}'; v_teams text[] := '{}';
begin
  if p is null or jsonb_typeof(p) <> 'array' then return '명단 형식이 잘못됐어요'; end if;
  if jsonb_array_length(p) = 0 then return null; end if;
  if jsonb_array_length(p) > 300 then return '명단은 300명까지예요'; end if;
  for v, i in select x.value, x.ord from jsonb_array_elements(p) with ordinality as x(value, ord) loop
    pre := i || '번째 사람: ';
    if jsonb_typeof(v) is distinct from 'object' then return pre || '형식이 잘못됐어요'; end if;
    u := lower(btrim(coalesce(v->>'uid', '')));
    if u = '' or length(u) > 40 then return pre || '아이디는 1~40자예요'; end if;
    if u = any (v_uids) then return pre || '아이디 ' || u || ' 가 두 번 나와요'; end if;
    v_uids := v_uids || u;
    if btrim(coalesce(v->>'name', '')) = '' or length(btrim(v->>'name')) > 20 then return pre || '이름은 1~20자예요'; end if;
    t := btrim(coalesce(v->>'team', ''));
    if t = '' or length(t) > 20 then return pre || '조 이름은 1~20자예요'; end if;
    if not (t = any (v_teams)) then v_teams := v_teams || t; end if;
  end loop;
  if cardinality(v_teams) < 2 then return '조가 2개 이상이어야 해요'; end if;
  if cardinality(v_teams) > 20 then return '조는 20개까지예요'; end if;
  return null;
end $$;

-- 기본 출전 보스 9명으로 (처음 설치할 때와 "보스 기본값으로" 버튼)
create or replace function public.raid_sim_seed_bosses() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.raid_sim_bosses where round >= 1;
  insert into public.raid_sim_bosses (round, name, description, hp, reward, has_event, dice_low, dice_high, stats, hint, reveal)
  select x.ord, x.v->>'name', x.v->>'desc', (x.v->>'hp')::integer, (x.v->>'reward')::integer, (x.v->>'event')::boolean,
         (x.v->>'diceLow')::integer, (x.v->>'diceHigh')::integer,
         array(select jsonb_array_elements_text(x.v->'stats')), x.v->>'hint', x.v->>'reveal'
  from jsonb_array_elements(public.raid_sim_default_bosses()) with ordinality as x(v, ord);
end $$;

-- 3) 내부 도우미 ----------------------------------------------------------

create or replace function public.raid_sim_initial_game() returns jsonb
language sql immutable as $$
  select jsonb_build_object('v', 1, 'stage', 'lobby', 'round', 0, 'phase', 'idle', 'hint', false,
    'deadline', null, 'shareDeadline', null, 'locked', false, 'results', '{}'::jsonb)
$$;

create or replace function public.raid_sim_seed() returns integer
language sql volatile as $$ select 1 + floor(random() * 2147483000)::integer $$;

-- 규칙(합계·최소·최대)에 맞는 랜덤 스탯
create or replace function public.raid_sim_random_stats() returns jsonb
language plpgsql volatile as $$
declare
  cfg jsonb := public.raid_sim_cfg(); k text[] := public.raid_sim_keys(); n integer := cardinality(public.raid_sim_keys());
  v_min integer := (cfg->>'statMin')::integer; v_max integer := (cfg->>'statMax')::integer; v_total integer := (cfg->>'statTotal')::integer;
  a integer[]; i integer; j integer; r jsonb := '{}'::jsonb;
begin
  a := array_fill(v_min, array[n]);
  for j in 1..greatest(v_total - v_min * n, 0) loop
    loop
      i := 1 + floor(random() * n)::integer;
      exit when a[i] < v_max;
    end loop;
    a[i] := a[i] + 1;
  end loop;
  for i in 1..n loop r := r || jsonb_build_object(k[i], a[i]); end loop;
  return r;
end $$;

-- 캐릭터를 안 만든 사람의 기본 스탯 (합계를 고르게 나눔)
create or replace function public.raid_sim_default_stats() returns jsonb
language plpgsql stable as $$
declare k text[] := public.raid_sim_keys(); n integer := cardinality(public.raid_sim_keys());
  t integer := (public.raid_sim_cfg()->>'statTotal')::integer; r jsonb := '{}'::jsonb; i integer;
begin
  for i in 1..n loop r := r || jsonb_build_object(k[i], t / n + case when i <= t % n then 1 else 0 end); end loop;
  return r;
end $$;

-- pid 가 before 라운드 전에 출전했는지
create or replace function public.raid_sim_played(s jsonb, p_pid integer, p_before integer) returns boolean
language sql immutable as $$
  select exists (
    select 1 from jsonb_each(coalesce(s->'picks', '{}'::jsonb)) k
    where (substring(k.key from '^r(\d+)t\d+$'))::integer between 1 and p_before - 1 and (k.value->>'pid')::integer = p_pid)
$$;

-- 명단 판에서는 아이디로 입장한 사람만 출전 후보 (6자리 연습판은 모두)
create or replace function public.raid_sim_present(s jsonb, p jsonb) returns boolean
language sql immutable as $$
  select s->>'mode' is distinct from 'roster' or coalesce((p->>'claimed')::boolean, false)
$$;

-- pid 가 before 라운드 전까지 몇 번 출전했는지 (연습 라운드는 세지 않음)
create or replace function public.raid_sim_plays(s jsonb, p_pid integer, p_before integer) returns integer
language sql immutable as $$
  select count(*)::integer from jsonb_each(coalesce(s->'picks', '{}'::jsonb)) k
  where (substring(k.key from '^r(\d+)t\d+$'))::integer between 1 and p_before - 1 and (k.value->>'pid')::integer = p_pid
$$;

-- 출전 제한: 한 사람 최대 2번, 조원이 6명 미만인 조는 3번 (js/raid.js · js/raid-sim-engine.js 와 같음)
create or replace function public.raid_sim_cap(s jsonb, p_team integer) returns integer
language sql immutable as $$
  select case when (select count(*) from jsonb_each(s->'people') p where (p.value->>'team')::integer = p_team) < 6 then 3 else 2 end
$$;

-- 이번 라운드에 고를 수 있는지: 입장했고 출전 횟수가 남은 사람.
-- 입장한 조원이 모두 다 썼으면 그중 가장 적게 나간 사람.
create or replace function public.raid_sim_can_pick(s jsonb, p_pid integer, p_team integer) returns boolean
language sql immutable as $$
  with v as (select (s#>>'{game,round}')::integer as r, public.raid_sim_cap(s, p_team) as cap),
       mates as (select public.raid_sim_plays(s, (p.value->>'id')::integer, v.r) as n
                 from jsonb_each(s->'people') p, v
                 where (p.value->>'team')::integer = p_team and public.raid_sim_present(s, p.value)),
       me as (select public.raid_sim_plays(s, p_pid, v.r) as n from v)
  select public.raid_sim_present(s, s->'people'->(p_pid::text))
     and ((select me.n from me) < (select v.cap from v)
          or (not exists (select 1 from mates, v where mates.n < v.cap)
              and (select me.n from me) = (select min(mates.n) from mates)))
$$;

create or replace function public.raid_sim_char(p jsonb) returns jsonb
language sql stable as $$
  select coalesce(nullif(p->'char', 'null'::jsonb),
    public.raid_sim_default_stats() || jsonb_build_object('seed', coalesce((p->>'seed')::integer, 1), 'isDefault', true))
$$;

-- 캐릭터를 안 만든 사람은 기본 스탯
create or replace function public.raid_sim_lock(s jsonb) returns jsonb
language plpgsql as $$
declare k text;
begin
  for k in select key from jsonb_each(s->'people') loop
    if s->'people'->k->'char' is null or s->'people'->k->'char' = 'null'::jsonb then
      s := jsonb_set(s, array['people', k, 'char'], public.raid_sim_char(s->'people'->k));
    end if;
  end loop;
  return s;
end $$;

-- 화면에 보낼 상태. 진행자가 아니면 결과 공개 전 라운드의 판정 스탯·공격력을 뺍니다.
create or replace function public.raid_sim_view(s jsonb, p_host boolean) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  g jsonb := s->'game';
  v_round integer := coalesce((s#>>'{game,round}')::integer, 0);
  v_open_cur boolean := (s#>>'{game,phase}') in ('revealed', 'final');
  v_rolled boolean := (s#>>'{game,phase}') = 'rolled';
  v_bosses jsonb;
  v_cfg jsonb := public.raid_sim_cfg();
  v_pb jsonb := public.raid_sim_cfg()->'practiceBoss';
  v_practice jsonb;
  v_results jsonb := '{}'::jsonb;
  k text; v jsonb;
begin
  select coalesce(jsonb_agg(
           jsonb_build_object('name', b.name, 'desc', b.description, 'hp', b.hp, 'reward', b.reward,
                              'event', b.has_event, 'diceLow', b.dice_low, 'diceHigh', b.dice_high, 'nStats', cardinality(b.stats))
           || case when p_host or b.round < v_round or (b.round = v_round and v_open_cur)
                   then jsonb_build_object('stats', to_jsonb(b.stats), 'hint', b.hint, 'reveal', b.reveal)
                   when b.round = v_round and coalesce((g->>'hint')::boolean, false)
                   then jsonb_build_object('hint', b.hint)
                   else '{}'::jsonb end
           order by b.round), '[]'::jsonb)
    into v_bosses from public.raid_sim_bosses b;

  -- 연습 보스 (0번 라운드)
  v_practice := jsonb_build_object('name', v_pb->'name', 'desc', v_pb->'desc', 'hp', v_pb->'hp', 'reward', 0, 'event', true, 'nStats', jsonb_array_length(v_pb->'stats'))
    || case when p_host or v_round > 0 or v_open_cur then jsonb_build_object('stats', v_pb->'stats', 'hint', v_pb->'hint', 'reveal', v_pb->'reveal')
            when coalesce((g->>'hint')::boolean, false) then jsonb_build_object('hint', v_pb->'hint')
            else '{}'::jsonb end;

  if g is not null and not p_host then
    for k, v in select key, value from jsonb_each(coalesce(g->'results', '{}'::jsonb)) loop
      if k::integer < v_round or (k::integer = v_round and v_open_cur) then
        v_results := v_results || jsonb_build_object(k, v);
      else
        v_results := v_results || jsonb_build_object(k, (
          select coalesce(jsonb_agg(jsonb_build_object('team', x->'team', 'pid', x->'pid', 'name', x->'name', 'auto', x->'auto')
                                    || case when k::integer = v_round and v_rolled
                                            then jsonb_build_object('dice', x->'dice', 'rolls', x->'rolls', 'bonus', x->'bonus', 'effect', x->'effect') else '{}'::jsonb end), '[]'::jsonb)
          from jsonb_array_elements(v) x));
      end if;
    end loop;
    g := jsonb_set(g, '{results}', v_results);
  end if;

  -- 참여자 화면에는 아이디(uid)를 보내지 않습니다.
  return jsonb_build_object('game', g,
                            'people', case when p_host then coalesce(s->'people', '{}'::jsonb)
                                           else coalesce((select jsonb_object_agg(key, value - 'uid') from jsonb_each(s->'people')), '{}'::jsonb) end,
                            'picks', coalesce(s->'picks', '{}'::jsonb),
                            'teams', coalesce(s->'teams', '["A조", "B조"]'::jsonb), 'mode', coalesce(s->>'mode', 'seats'),
                            'storyDrafts', case when p_host then coalesce(s->'storyDrafts', '{}'::jsonb) else '{}'::jsonb end,
                            'bosses', v_bosses, 'practice', v_practice, 'config', case when p_host then v_cfg else v_cfg - 'practiceBoss' - 'bossPool' end, 'isHost', p_host, 'now', public.raid_sim_ms());
end $$;

-- 상태를 저장하고 공개 상태를 다시 씁니다 (Realtime 으로 모든 화면에 감).
create or replace function public.raid_sim_store(s jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.raid_sim_state set state = s, updated_at = now() where id = 1;
  update public.raid_sim_public set data = public.raid_sim_view(s, false), rev = rev + 1, updated_at = now() where id = 1;
end $$;

-- 새 판: 명단이 있으면 명단대로(조는 명단에 처음 나온 순서), 없으면 6자리(A조·B조 3명씩)
create or replace function public.raid_sim_fresh() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_people jsonb := '{}'::jsonb; i integer := 0; v_roster jsonb; v_teams jsonb := '[]'::jsonb; r jsonb; t integer;
begin
  select data into v_roster from public.raid_sim_roster where id = 1;
  -- 진행자가 넣은 명단이 없으면 워크샵 명단(관리 화면 '명단 · 조')을 그대로 씁니다. Chief Crew 조는 뺍니다.
  if (v_roster is null or jsonb_typeof(v_roster) <> 'array' or jsonb_array_length(v_roster) = 0)
     and to_regclass('public.participants') is not null and to_regclass('public.teams') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('uid', p.knox_id, 'name', left(btrim(p.name), 20),
                                                   'team', left(coalesce(nullif(btrim(t.name), ''), p.team_no || '조'), 20))
                                order by p.team_no, p.name), '[]'::jsonb)
        from public.participants p join public.teams t on t.team_no = p.team_no
       where t.name !~* '(chief|치프)'
    $q$ into v_roster;
  end if;
  if v_roster is null or jsonb_typeof(v_roster) <> 'array' or jsonb_array_length(v_roster) = 0 then
    for i in 0..5 loop
      v_people := v_people || jsonb_build_object(i::text, jsonb_build_object(
        'id', i, 'name', '참여자 ' || (i + 1), 'team', case when i < 3 then 0 else 1 end,
        'char', null, 'seed', public.raid_sim_seed(), 'rerolls', 0, 'claimed', false));
    end loop;
    return jsonb_build_object('game', public.raid_sim_initial_game(), 'people', v_people, 'picks', '{}'::jsonb,
                              'teams', '["A조", "B조"]'::jsonb, 'mode', 'seats');
  end if;
  for r in select x.value from jsonb_array_elements(v_roster) with ordinality as x(value, ord) order by x.ord loop
    if not (v_teams @> jsonb_build_array(r->>'team')) then v_teams := v_teams || jsonb_build_array(r->>'team'); end if;
    select (x.ord - 1)::integer into t from jsonb_array_elements_text(v_teams) with ordinality as x(v, ord) where x.v = r->>'team';
    v_people := v_people || jsonb_build_object(i::text, jsonb_build_object(
      'id', i, 'uid', r->>'uid', 'name', r->>'name', 'team', t,
      'char', null, 'seed', public.raid_sim_seed(), 'rerolls', 0, 'claimed', false));
    i := i + 1;
  end loop;
  return jsonb_build_object('game', public.raid_sim_initial_game(), 'people', v_people, 'picks', '{}'::jsonb,
                            'teams', v_teams, 'mode', 'roster');
end $$;

-- 돌발 이벤트 룰렛: 운이 높을수록 아래쪽 칸 쪽으로 기울어짐. 1부터 시작하는 칸 번호 (js/raid-sim-engine.js 의 rollSpin 과 같음)
create or replace function public.raid_sim_roll(cfg jsonb, luck integer) returns integer
language plpgsql volatile as $$
declare
  v_min integer := (cfg->>'statMin')::integer; v_max integer := (cfg->>'statMax')::integer;
  v_t double precision; v_r double precision; v_total double precision := 0; v_u double precision; k integer;
  n integer := greatest(1, coalesce(jsonb_array_length(cfg->'roulette'), 6));
begin
  v_t := case when v_max > v_min then least(1, greatest(0, (coalesce(luck, 0) - v_min)::double precision / (v_max - v_min))) else 0 end;
  v_r := power(1 + coalesce((cfg->>'luckPower')::double precision, 0) / 100, v_t);
  for k in 1..n loop v_total := v_total + power(v_r, k - 1); end loop;
  v_u := random() * v_total;
  for k in 1..n loop
    v_u := v_u - power(v_r, k - 1);
    if v_u < 0 then return k; end if;
  end loop;
  return n;
end $$;
revoke all on function public.raid_sim_roll(jsonb, integer) from public, anon, authenticated;

-- 마감: 안 고른 조는 덜 나간 사람 중 랜덤, 그다음 스탯 판정
create or replace function public.raid_sim_close(s jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r integer := (s#>>'{game,round}')::integer;
  cfg jsonb := public.raid_sim_cfg();
  v_mvp integer := (cfg->>'mvpBonus')::integer;
  b public.raid_sim_bosses;
  v_last integer := jsonb_array_length(coalesce(s->'teams', '["A조", "B조"]'::jsonb)) - 1;
  t integer; v_pid integer; v_key text; p jsonb; c jsonb;
  v_base integer; v_dice integer; v_bonus integer; v_power integer; v_rolls jsonb; v_extra integer; v_eff jsonb;
  v_rows jsonb := '[]'::jsonb; v_max integer; v_dr jsonb;
begin
  if r = 0 then
    -- 연습 보스: 룰렛 항상, 보상 없음
    b.round := 0; b.name := cfg#>>'{practiceBoss,name}'; b.hp := (cfg#>>'{practiceBoss,hp}')::integer; b.reward := 0; b.has_event := true;
    b.stats := array(select jsonb_array_elements_text(cfg#>'{practiceBoss,stats}'));
  else
    select * into b from public.raid_sim_bosses where round = r;
  end if;
  for t in 0..v_last loop
    v_key := 'r' || r || 't' || t;
    if s->'picks'->v_key is null then
      -- 아무도 안 골랐으면: 입장한 사람 → 출전 횟수가 남은 사람 → 덜 나간 사람 순으로, 그 안에서 랜덤
      select (pp.value->>'id')::integer into v_pid from jsonb_each(s->'people') pp
       where (pp.value->>'team')::integer = t
       order by not public.raid_sim_present(s, pp.value),
                public.raid_sim_plays(s, (pp.value->>'id')::integer, r) >= public.raid_sim_cap(s, t),
                public.raid_sim_plays(s, (pp.value->>'id')::integer, r), random()
       limit 1;
      s := jsonb_set(s, array['picks', v_key], jsonb_build_object('pid', v_pid, 'by', null, 'auto', true));
    end if;
  end loop;

  for t in 0..v_last loop
    v_key := 'r' || r || 't' || t;
    v_pid := (s->'picks'->v_key->>'pid')::integer;
    p := s->'people'->(v_pid::text);
    c := public.raid_sim_char(p);
    select coalesce(sum(coalesce((c->>st)::integer, 0)), 0) into v_base from unnest(b.stats) st;
    -- 돌발 이벤트: 운으로 기울어진 룰렛 (dice = 나온 칸 번호, effect = 그 칸의 효과)
    v_dice := null; v_bonus := 0; v_rolls := null; v_eff := null;
    if b.has_event then
      v_dice := public.raid_sim_roll(cfg, (c->>'luck')::integer);
      v_rolls := jsonb_build_array(v_dice);
      v_eff := cfg->'roulette'->(v_dice - 1);
      v_bonus := case when v_eff->>'kind' = 'power' then (v_eff->>'value')::integer else 0 end;
    end if;
    v_power := v_base + v_bonus;
    v_extra := case when (v_eff->>'kind' = 'clear' and v_power >= b.hp) or (v_eff->>'kind' = 'fail' and v_power < b.hp) then (v_eff->>'value')::integer else 0 end;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'team', t, 'pid', v_pid, 'name', p->>'name', 'base', v_base, 'dice', v_dice, 'rolls', v_rolls, 'effect', v_eff, 'bonus', v_bonus,
      'power', v_power, 'cleared', v_power >= b.hp, 'extra', v_extra, 'auto', coalesce((s->'picks'->v_key->>'auto')::boolean, false)));
  end loop;

  select max((x->>'power')::integer) into v_max from jsonb_array_elements(v_rows) x;
  select jsonb_agg(x || jsonb_build_object(
           'mvp', (x->>'power')::integer = v_max,
           'points', (case when (x->>'cleared')::boolean then b.reward else 0 end) + (case when (x->>'power')::integer = v_max then v_mvp else 0 end)
                     + (x->>'extra')::integer))
    into v_rows from jsonb_array_elements(v_rows) x;

  -- 회의 중에 미리 쓴 AI 서술: 출전자·격파 여부가 같고 룰렛이 공격력을 바꾸지 않았으면 그대로 씀 (나머지는 Edge Function 이 마감 뒤 씀)
  v_dr := s->'storyDrafts'->('r' || r);
  if v_dr is not null and jsonb_typeof(v_dr) = 'object' then
    select jsonb_agg(case when jsonb_typeof(v_dr->(x->>'team')) = 'object'
                            and (v_dr->(x->>'team')->>'pid') = (x->>'pid')
                            and (v_dr->(x->>'team')->>'cleared') = (x->>'cleared')
                            and coalesce(x->'effect'->>'kind', 'none') <> 'power'
                       then x || jsonb_build_object('story', left(v_dr->(x->>'team')->>'text', 240)) else x end order by o)
      into v_rows from jsonb_array_elements(v_rows) with ordinality as t(x, o);
  end if;
  s := jsonb_set(s, array['game', 'results', r::text], v_rows);
  s := jsonb_set(s, '{game,phase}', '"closed"');
  s := jsonb_set(s, '{game,deadline}', 'null');
  return s;
end $$;

-- 4) 진행자 동작 (raid-sim Edge Function 이 비밀번호를 확인한 뒤 부릅니다) -----------
-- op: state | setup | make | fillChars | share | raid | start(arg=라운드, 0 = 연습) | hint | close | roll(돌발 이벤트 룰렛) | reveal | final | back(이전 단계) | reset | resetSeats
--     saveConfig(data=규칙) | saveBosses(data=보스 배열) | resetBosses | saveRoster(data=[{uid,name,team}], 빈 배열이면 6자리)
create or replace function public.raid_sim_admin(p_op text, p_arg integer default null, p_data jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s jsonb; g jsonb; k text; err text := null;
  v_stage text; v_phase text; v_round integer; v_n integer;
  v_now bigint := public.raid_sim_ms();
  v_cfg jsonb; v_new jsonb;
begin
  select state into s from public.raid_sim_state where id = 1 for update;
  if s is null then
    s := public.raid_sim_fresh();
    insert into public.raid_sim_state (id, state) values (1, s) on conflict (id) do update set state = excluded.state;
  end if;
  select count(*) into v_n from public.raid_sim_bosses;
  v_cfg := public.raid_sim_cfg();
  g := s->'game';
  v_stage := g->>'stage'; v_phase := g->>'phase'; v_round := coalesce((g->>'round')::integer, 0);

  case p_op
    when 'state' then return jsonb_build_object('ok', true, 'view', public.raid_sim_view(s, true));
    when 'setup' then s := public.raid_sim_fresh();
    when 'make' then
      if v_stage <> 'lobby' then err := '대기 단계에서만 시작할 수 있어요';
      else
        -- 진행자가 명단을 따로 넣지 않았으면 워크샵 명단(명단 · 조 탭)으로 다시 맞춘 뒤 시작합니다
        if not exists (select 1 from public.raid_sim_roster where id = 1 and jsonb_typeof(data) = 'array' and jsonb_array_length(data) > 0) then
          s := public.raid_sim_fresh();
        end if;
        s := jsonb_set(s, '{game,stage}', '"make"');
      end if;
    when 'fillChars' then
      if (g->>'locked')::boolean then err := '캐릭터가 이미 잠겼어요';
      else
        for k in select key from jsonb_each(s->'people') loop
          if s->'people'->k->'char' = 'null'::jsonb or s->'people'->k->'char' is null then
            s := jsonb_set(s, array['people', k, 'char'], public.raid_sim_random_stats() || jsonb_build_object('seed', s->'people'->k->'seed'));
          end if;
        end loop;
      end if;
    when 'share' then
      if v_stage <> 'make' then err := '캐릭터 만들기 다음에 넘길 수 있어요';
      else s := jsonb_set(s, '{game}', g || jsonb_build_object('stage', 'share', 'shareDeadline', v_now + (v_cfg->>'shareMin')::integer * 60000)); end if;
    when 'raid' then
      if v_stage not in ('make', 'share') then err := '조 내 공유 다음에 넘길 수 있어요';
      else
        s := public.raid_sim_lock(s);
        s := jsonb_set(s, '{game}', s->'game' || jsonb_build_object('stage', 'boss', 'round', 0, 'phase', 'idle', 'locked', true));
      end if;
    when 'start' then
      if not (v_stage = 'boss' and p_arg between 0 and v_n and (
               (p_arg in (0, 1) and (v_phase = 'idle' or v_round = 0))
            or (p_arg = v_round and v_phase in ('closed', 'rolled'))
            or (p_arg = v_round + 1 and v_phase = 'revealed'))) then
        err := case when p_arg = 0 then '연습은 본게임 전에만 할 수 있어요' else '지금은 ' || coalesce(p_arg::text, '?') || '번 보스를 시작할 수 없어요' end;
      else
        s := public.raid_sim_lock(s);
        s := jsonb_set(s, '{picks}', coalesce((select jsonb_object_agg(key, value) from jsonb_each(s->'picks')
                                               where (substring(key from '^r(\d+)t\d+$'))::integer < p_arg), '{}'::jsonb));
        s := jsonb_set(s, '{game,results}', coalesce((select jsonb_object_agg(key, value) from jsonb_each(s#>'{game,results}')
                                                      where key::integer < p_arg), '{}'::jsonb));
        s := jsonb_set(s, '{storyDrafts}', coalesce(s->'storyDrafts', '{}'::jsonb) - ('r' || p_arg));
        s := jsonb_set(s, '{game}', s->'game' || jsonb_build_object('round', p_arg, 'phase', 'meeting', 'hint', false, 'view', 0, 'locked', true,
                                                                    'deadline', v_now + (v_cfg->>(case when p_arg = 0 then 'practiceMeetingSec' else 'meetingSec' end))::integer * 1000));
      end if;
    when 'hint' then
      if v_phase <> 'meeting' then err := '회의 중에만 힌트를 열 수 있어요';
      else s := jsonb_set(s, '{game,hint}', 'true'); end if;
    when 'close' then
      if v_phase <> 'meeting' then err := '회의 중에만 마감할 수 있어요';
      else s := public.raid_sim_close(s); end if;
    when 'roll' then
      if v_phase <> 'closed' then err := '마감한 뒤에 룰렛을 돌릴 수 있어요';
      elsif v_round > 0 and not coalesce((select has_event from public.raid_sim_bosses where round = v_round), false) then err := '이번 보스는 돌발 이벤트가 없어요';
      else s := jsonb_set(s, '{game}', s->'game' || jsonb_build_object('phase', 'rolled', 'rollAt', v_now)); end if;
    when 'reveal' then
      -- p_arg 가 있으면(결과 공개 뒤): 발표 화면 결과 장 바꾸기 0 공격력 · 1 점수표 · 2 중간 집계 (연습은 0 · 1만)
      if p_arg is not null then
        if v_phase <> 'revealed' then err := '결과 공개 뒤에 넘길 수 있어요';
        elsif p_arg not between 0 and 2 or (p_arg = 2 and v_round = 0) then err := '그 화면은 없어요';
        else s := jsonb_set(s, '{game,view}', to_jsonb(p_arg)); end if;
      elsif v_phase = 'closed' and (v_round = 0 or coalesce((select has_event from public.raid_sim_bosses where round = v_round), false)) then
        err := '돌발 이벤트 라운드예요. 먼저 "룰렛 돌리기"를 눌러 주세요';
      elsif v_phase not in ('closed', 'rolled') then err := '마감한 뒤에 공개할 수 있어요';
      else s := jsonb_set(s, '{game}', s->'game' || '{"phase": "revealed", "view": 0}'::jsonb); end if;
    when 'final' then
      if v_phase <> 'revealed' then err := '결과 공개 뒤에 최종 순위를 띄울 수 있어요';
      else s := jsonb_set(s, '{game,phase}', '"final"'); end if;
    when 'setDrafts' then
      -- 회의 중에 미리 쓴 AI 서술 (Edge Function raid-sim 의 story, mode draft). p_data = {"조 번호": {pid, cleared, text}, …}
      -- 그사이 출전자가 바뀐 조는 버림
      if v_phase <> 'meeting' or p_arg is distinct from v_round then err := '회의 중에만 미리 쓸 수 있어요';
      elsif p_data is null or jsonb_typeof(p_data) <> 'object' then err := '서술 형식이 잘못됐어요';
      else
        s := jsonb_set(s, '{storyDrafts}', coalesce(s->'storyDrafts', '{}'::jsonb) || jsonb_build_object('r' || p_arg,
               coalesce(s->'storyDrafts'->('r' || p_arg), '{}'::jsonb) || coalesce((
                 select jsonb_object_agg(d.key, jsonb_build_object('pid', (d.value->>'pid')::integer, 'cleared', (d.value->>'cleared')::boolean, 'text', left(d.value->>'text', 240)))
                   from jsonb_each(p_data) d
                  where jsonb_typeof(d.value) = 'object' and jsonb_typeof(d.value->'text') = 'string'
                    and (s->'picks'->('r' || p_arg || 't' || d.key)->>'pid') = (d.value->>'pid')), '{}'::jsonb)));
      end if;
    when 'setStories' then
      -- AI 서술(Edge Function raid-sim 의 story)을 이번 라운드 결과에 붙임. p_data = {"_sig": 판정 서명, "조 번호": "서술", …}
      -- 그사이 다시 마감해 판정이 바뀌었으면(서명이 다르면) 붙이지 않습니다.
      if p_arg is null or p_arg <> v_round or s#>array['game', 'results', p_arg::text] is null then err := '이번 라운드 판정이 없어요';
      elsif p_data is null or jsonb_typeof(p_data) <> 'object'
         or p_data->>'_sig' is distinct from (select string_agg((x->>'pid') || ':' || (x->>'power'), ',' order by o)
                                               from jsonb_array_elements(s#>array['game', 'results', p_arg::text]) with ordinality as t(x, o)) then
        err := '판정이 바뀌어서 서술을 다시 만들어야 해요';
      else
        s := jsonb_set(s, array['game', 'results', p_arg::text], (
          select coalesce(jsonb_agg(case when jsonb_typeof(p_data->(x->>'team')) = 'string'
                                         then x || jsonb_build_object('story', left(p_data->>(x->>'team'), 240)) else x end order by o), '[]'::jsonb)
            from jsonb_array_elements(s#>array['game', 'results', p_arg::text]) with ordinality as t(x, o)));
      end if;
    when 'back' then
      -- 한 단계 전으로 (js/raid-sim-engine.js 의 back 과 같음)
      if v_stage is null or v_stage = 'lobby' then err := '더 이전 단계가 없어요';
      elsif v_stage = 'make' then s := jsonb_set(s, '{game,stage}', '"lobby"');
      elsif v_stage = 'share' then s := jsonb_set(s, '{game}', g || jsonb_build_object('stage', 'make', 'shareDeadline', null));
      elsif v_phase = 'idle' then
        s := jsonb_set(s, '{game}', g || jsonb_build_object('stage', 'share', 'locked', false, 'shareDeadline', v_now + (v_cfg->>'shareMin')::integer * 60000));
      elsif v_phase = 'meeting' then
        s := jsonb_set(s, '{picks}', coalesce((select jsonb_object_agg(key, value) from jsonb_each(s->'picks')
                                               where (substring(key from '^r(\d+)t\d+$'))::integer < v_round), '{}'::jsonb));
        s := jsonb_set(s, '{game,results}', coalesce((select jsonb_object_agg(key, value) from jsonb_each(s#>'{game,results}')
                                                      where key::integer < v_round), '{}'::jsonb));
        if v_round = 0 or not (s#>'{game,results}' ? (v_round - 1)::text) then
          s := jsonb_set(s, '{game}', s->'game' || jsonb_build_object('round', 0, 'phase', 'idle', 'hint', false, 'deadline', null));
        else
          s := jsonb_set(s, '{game}', s->'game' || jsonb_build_object('round', v_round - 1, 'phase', 'revealed', 'hint', false, 'deadline', null));
        end if;
      elsif v_phase = 'closed' then
        -- 마감 취소: 이번 라운드 결과와 자동으로 정해진 출전자만 지우고 회의로
        s := jsonb_set(s, '{picks}', coalesce((select jsonb_object_agg(key, value) from jsonb_each(s->'picks')
                                               where not ((substring(key from '^r(\d+)t\d+$'))::integer = v_round and coalesce((value->>'auto')::boolean, false))), '{}'::jsonb));
        s := jsonb_set(s, '{game,results}', coalesce(s#>'{game,results}', '{}'::jsonb) - v_round::text);
        s := jsonb_set(s, '{game}', s->'game' || jsonb_build_object('phase', 'meeting', 'deadline', v_now + (v_cfg->>(case when v_round = 0 then 'practiceMeetingSec' else 'meetingSec' end))::integer * 1000));
      elsif v_phase = 'rolled' then s := jsonb_set(s, '{game}', s->'game' || jsonb_build_object('phase', 'closed', 'rollAt', null));
      elsif v_phase = 'revealed' and coalesce((g->>'view')::integer, 0) > 0 then s := jsonb_set(s, '{game,view}', '0');
      elsif v_phase = 'revealed' then
        s := jsonb_set(s, '{game,phase}', (case when v_round = 0 or coalesce((select has_event from public.raid_sim_bosses where round = v_round), false)
                                                then '"rolled"' else '"closed"' end)::jsonb);
      elsif v_phase = 'final' then s := jsonb_set(s, '{game,phase}', '"revealed"');
      else err := '돌아갈 수 없어요'; end if;
    when 'reset' then
      for k in select key from jsonb_each(s->'people') loop
        s := jsonb_set(s, array['people', k], s->'people'->k || jsonb_build_object('char', null, 'rerolls', 0));
      end loop;
      s := (s - 'storyDrafts') || jsonb_build_object('game', public.raid_sim_initial_game(), 'picks', '{}'::jsonb);
    when 'resetSeats' then
      -- 명단으로 만든 판은 이름은 두고 입장 표시만 지웁니다.
      for k in select key from jsonb_each(s->'people') loop
        s := jsonb_set(s, array['people', k], s->'people'->k || jsonb_build_object('claimed', false)
             || case when s->'people'->k ? 'uid' then '{}'::jsonb else jsonb_build_object('name', '참여자 ' || (k::integer + 1)) end);
      end loop;
    when 'saveRoster' then
      if coalesce(v_stage, 'lobby') <> 'lobby' then
        err := '명단은 대기 단계에서만 바꿀 수 있어요. 진행 탭에서 "처음부터"를 누른 뒤 적용해 주세요';
      else
        err := public.raid_sim_check_roster(p_data);
        if err is null then
          insert into public.raid_sim_roster (id, data)
          values (1, (select coalesce(jsonb_agg(jsonb_build_object('uid', lower(btrim(x.v->>'uid')), 'name', btrim(x.v->>'name'), 'team', btrim(x.v->>'team')) order by x.ord), '[]'::jsonb)
                      from jsonb_array_elements(p_data) with ordinality as x(v, ord)))
          on conflict (id) do update set data = excluded.data, updated_at = now();
          s := public.raid_sim_fresh();
        end if;
      end if;
    when 'saveConfig' then
      if p_data is null or jsonb_typeof(p_data) <> 'object' then err := '규칙 형식이 잘못됐어요';
      else
        v_new := v_cfg || coalesce((select jsonb_object_agg(key, value) from jsonb_each(p_data)
                                    where key in (select jsonb_object_keys(public.raid_sim_default_config()))), '{}'::jsonb);
        if jsonb_typeof(v_new->'rulesLines') = 'array' then
          v_new := jsonb_set(v_new, '{rulesLines}', coalesce((select jsonb_agg(btrim(x)) from jsonb_array_elements_text(v_new->'rulesLines') x where btrim(x) <> ''), '[]'::jsonb));
        end if;
        err := public.raid_sim_check_config(v_new);
        if err is null and coalesce(v_stage, 'lobby') <> 'lobby'
           and (v_new->'statTotal', v_new->'statMin', v_new->'statMax') is distinct from (v_cfg->'statTotal', v_cfg->'statMin', v_cfg->'statMax') then
          err := '스탯 규칙(합계·최소·최대)은 대기 단계에서만 바꿀 수 있어요. "처음부터"를 누르면 대기 단계로 돌아가요';
        end if;
        if err is null and v_round = 0 and v_phase in ('meeting', 'closed', 'rolled') and v_new->'practiceBoss' is distinct from v_cfg->'practiceBoss' then
          err := '연습 라운드 진행 중에는 연습 보스를 바꿀 수 없어요';
        end if;
        if err is null then
          insert into public.raid_sim_config (id, data) values (1, v_new)
            on conflict (id) do update set data = excluded.data, updated_at = now();
        end if;
      end if;
    when 'saveBosses' then
      if v_phase in ('meeting', 'closed', 'rolled') then err := '라운드 진행 중(회의·마감)에는 보스를 바꿀 수 없어요. 결과 공개 뒤에 저장해 주세요';
      else
        err := public.raid_sim_check_bosses(p_data);
        if err is null and v_stage = 'boss' and jsonb_array_length(p_data) < v_round then
          err := '이미 진행한 ' || v_round || '라운드보다 보스 수를 줄일 수 없어요';
        end if;
        if err is null then
          delete from public.raid_sim_bosses where round >= 1;
          insert into public.raid_sim_bosses (round, name, description, hp, reward, has_event, dice_low, dice_high, stats, hint, reveal)
          select x.ord, btrim(x.v->>'name'), x.v->>'desc', (x.v->>'hp')::integer, (x.v->>'reward')::integer, (x.v->>'event')::boolean,
                 (x.v->>'diceLow')::integer, (x.v->>'diceHigh')::integer,
                 array(select jsonb_array_elements_text(x.v->'stats')), x.v->>'hint', x.v->>'reveal'
          from jsonb_array_elements(p_data) with ordinality as x(v, ord);
        end if;
      end if;
    when 'resetBosses' then
      if v_phase in ('meeting', 'closed', 'rolled') then err := '라운드 진행 중(회의·마감)에는 보스를 바꿀 수 없어요';
      elsif v_stage = 'boss' and v_round > jsonb_array_length(public.raid_sim_default_bosses()) then err := '이미 진행한 라운드보다 보스 수를 줄일 수 없어요';
      else
        perform public.raid_sim_seed_bosses();
        update public.raid_sim_config set data = data - 'bossPool', updated_at = now() where id = 1;
      end if;
    else err := '알 수 없는 동작이에요';
  end case;

  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  perform public.raid_sim_store(s);
  return jsonb_build_object('ok', true, 'view', public.raid_sim_view(s, true));
end $$;

-- 5) 참여자 동작 (공개 키로 부름) ---------------------------------------------
-- action: claim {name} | save {stats:{hp,intel,social,mental,luck}} | reroll | pick {m}
create or replace function public.raid_sim_act(p_pid integer, p_action text, p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s jsonb; g jsonb; p jsonb; m jsonb; k text := p_pid::text; v_name text;
  st jsonb; v_seed integer; v_round integer; v_editable boolean;
  v_ok boolean; v_sum integer; v_key text; v_char jsonb;
  cfg jsonb := public.raid_sim_cfg();
  v_min integer := (cfg->>'statMin')::integer; v_max integer := (cfg->>'statMax')::integer; v_total integer := (cfg->>'statTotal')::integer;
begin
  select state into s from public.raid_sim_state where id = 1 for update;
  if s is null then return jsonb_build_object('ok', false, 'error', '진행자가 아직 게임을 준비하지 않았어요'); end if;
  g := s->'game'; p := s->'people'->k; p_data := coalesce(p_data, '{}'::jsonb);
  if g is null or p is null then return jsonb_build_object('ok', false, 'error', '자리를 찾을 수 없어요'); end if;
  v_editable := not coalesce((g->>'locked')::boolean, false) and g->>'stage' in ('make', 'share');

  if p_action = 'claim' then
    if s->>'mode' = 'roster' then return jsonb_build_object('ok', false, 'error', '아이디로 입장해 주세요'); end if;
    v_name := left(btrim(regexp_replace(coalesce(p_data->>'name', ''), '\s+', ' ', 'g')), 12);
    p := p || jsonb_build_object('claimed', true) || case when v_name <> '' then jsonb_build_object('name', v_name) else '{}'::jsonb end;

  elsif p_action = 'save' then
    if not v_editable then return jsonb_build_object('ok', false, 'error', '지금은 캐릭터를 바꿀 수 없어요'); end if;
    st := p_data->'stats';
    v_ok := st is not null and jsonb_typeof(st) = 'object';
    v_sum := 0; v_char := '{}'::jsonb;
    if v_ok then
      foreach v_key in array public.raid_sim_keys() loop
        if not public.raid_sim_is_int(st->v_key, v_min, v_max) then v_ok := false; exit; end if;
        v_sum := v_sum + (st->>v_key)::integer;
        v_char := v_char || jsonb_build_object(v_key, (st->>v_key)::integer);
      end loop;
    end if;
    if not v_ok or v_sum <> v_total then
      return jsonb_build_object('ok', false, 'error', '스탯은 하나에 ' || v_min || '~' || v_max || '점, 합계 ' || v_total || '점이어야 해요');
    end if;
    p := jsonb_set(p, '{char}', v_char || jsonb_build_object('seed', p->'seed'));

  elsif p_action = 'reroll' then
    if not v_editable then return jsonb_build_object('ok', false, 'error', '지금은 외형 랜덤 뽑기를 할 수 없어요'); end if;
    if p->'char' is null or p->'char' = 'null'::jsonb or (p->>'rerolls')::integer >= (cfg->>'rerolls')::integer then
      return jsonb_build_object('ok', false, 'error', '외형 랜덤 뽑기를 모두 썼어요');
    end if;
    v_seed := public.raid_sim_seed();
    p := p || jsonb_build_object('seed', v_seed, 'rerolls', (p->>'rerolls')::integer + 1, 'char', p->'char' || jsonb_build_object('seed', v_seed));

  elsif p_action = 'pick' then
    if g->>'phase' <> 'meeting' then return jsonb_build_object('ok', false, 'error', '회의 시간이 끝났어요'); end if;
    m := s->'people'->(p_data->>'m');
    if m is null or (m->>'team') <> (p->>'team') then return jsonb_build_object('ok', false, 'error', '우리 조원만 고를 수 있어요'); end if;
    if not public.raid_sim_present(s, m) then
      return jsonb_build_object('ok', false, 'error', '아직 입장하지 않은 사람이에요. 아이디로 입장한 사람만 고를 수 있어요');
    end if;
    if not public.raid_sim_can_pick(s, (m->>'id')::integer, (p->>'team')::integer) then
      return jsonb_build_object('ok', false, 'error', '출전 횟수를 다 쓴 사람이에요');
    end if;
    v_round := (g->>'round')::integer;
    s := jsonb_set(s, array['picks', 'r' || v_round || 't' || (p->>'team')], jsonb_build_object('pid', (m->>'id')::integer, 'by', p_pid, 'auto', false));
    perform public.raid_sim_store(s);
    return jsonb_build_object('ok', true);

  else
    return jsonb_build_object('ok', false, 'error', '알 수 없는 동작이에요');
  end if;

  s := jsonb_set(s, array['people', k], p);
  perform public.raid_sim_store(s);
  return jsonb_build_object('ok', true);
end $$;

-- 명단으로 만든 판: 휴대폰에서 아이디를 넣으면 명단의 자리(이름·조)를 찾아 줍니다 (공개 키로 부름).
create or replace function public.raid_sim_login(p_uid text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb; v text := lower(btrim(coalesce(p_uid, ''))); k text;
begin
  select state into s from public.raid_sim_state where id = 1 for update;
  if s is null or s->>'mode' is distinct from 'roster' then
    return jsonb_build_object('ok', false, 'error', '지금은 아이디 입장을 쓰지 않아요. 자리를 골라 주세요');
  end if;
  if v = '' then return jsonb_build_object('ok', false, 'error', '아이디를 적어 주세요'); end if;
  select key into k from jsonb_each(s->'people') where value->>'uid' = v limit 1;
  if k is null then return jsonb_build_object('ok', false, 'error', '명단에 없는 아이디예요. 진행자에게 알려 주세요'); end if;
  if not coalesce((s->'people'->k->>'claimed')::boolean, false) then
    s := jsonb_set(s, array['people', k, 'claimed'], 'true');
    perform public.raid_sim_store(s);
  end if;
  return jsonb_build_object('ok', true, 'pid', k::integer, 'name', s->'people'->k->>'name');
end $$;

-- 6) 권한 ----------------------------------------------------------------
revoke all on function
  public.raid_sim_ms(), public.raid_sim_keys(), public.raid_sim_default_bosses(), public.raid_sim_default_config(), public.raid_sim_cfg(),
  public.raid_sim_is_int(jsonb, integer, integer), public.raid_sim_check_config(jsonb), public.raid_sim_check_bosses(jsonb, integer), public.raid_sim_check_roster(jsonb),
  public.raid_sim_seed_bosses(), public.raid_sim_initial_game(), public.raid_sim_seed(), public.raid_sim_random_stats(),
  public.raid_sim_default_stats(), public.raid_sim_played(jsonb, integer, integer), public.raid_sim_plays(jsonb, integer, integer), public.raid_sim_cap(jsonb, integer), public.raid_sim_present(jsonb, jsonb), public.raid_sim_can_pick(jsonb, integer, integer),
  public.raid_sim_char(jsonb), public.raid_sim_lock(jsonb), public.raid_sim_view(jsonb, boolean),
  public.raid_sim_store(jsonb), public.raid_sim_fresh(), public.raid_sim_close(jsonb),
  public.raid_sim_admin(text, integer, jsonb), public.raid_sim_act(integer, text, jsonb), public.raid_sim_login(text)
  from public, anon, authenticated;
grant execute on function public.raid_sim_admin(text, integer, jsonb) to service_role;
grant execute on function public.raid_sim_act(integer, text, jsonb) to anon, authenticated, service_role;
grant execute on function public.raid_sim_login(text) to anon, authenticated, service_role;

-- 7) 처음 실행할 때만: 보스, 규칙, 6자리와 대기 상태 (이미 있으면 그대로) -------------
--    보스를 새로 바꾼 버전(bossVersion 3: 직장 빌런 9명 + 보스 목록)은 이 파일을 처음 실행할 때 한 번만 출전 보스를 새 기본값으로 바꿉니다.
insert into public.raid_sim_config (id) values (1) on conflict (id) do nothing;
do $$ begin
  if not exists (select 1 from public.raid_sim_bosses)
     or coalesce((select data->>'bossVersion' from public.raid_sim_config where id = 1), '') <> '3' then
    perform public.raid_sim_seed_bosses();
    update public.raid_sim_config set data = (data - 'bossPool') || '{"bossVersion": "3"}'::jsonb, updated_at = now() where id = 1;
  end if;
end $$;
insert into public.raid_sim_roster (id) values (1) on conflict (id) do nothing;
insert into public.raid_sim_state (id, state) values (1, public.raid_sim_fresh()) on conflict (id) do nothing;
insert into public.raid_sim_public (id) values (1) on conflict (id) do nothing;
select public.raid_sim_store(state) from public.raid_sim_state where id = 1;

-- 7) 워크샵 플랫폼: 메인 관제의 프로그램 목록에 'raid'(보스 레이드)를 더합니다 (platform.sql · teamvote.sql 과 같은 목록) --
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sessions' and column_name = 'program') then
    update public.sessions set program = 'lobby' where program not in ('lobby', 'wordcloud', 'dinner', 'teamvote', 'raid', 'end');
    alter table public.sessions drop constraint if exists sessions_program_check;
    alter table public.sessions add  constraint sessions_program_check
      check (program in ('lobby', 'wordcloud', 'dinner', 'teamvote', 'raid', 'end'));
  end if;
end $$;
