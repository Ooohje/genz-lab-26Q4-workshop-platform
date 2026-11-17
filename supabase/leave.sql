-- =====================================================================
-- Gen Z Lab. 워크샵 플랫폼 — 로그아웃하면 입장 취소
-- platform.sql 을 이미 실행한 프로젝트에 "추가로" 실행합니다.
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run 하세요. 여러 번 실행해도 안전합니다.
-- =====================================================================

-- 참여자가 "다른 Knox ID로 입장"을 누르면 불립니다.
-- 입장 표시만 지웁니다. 명단·조·석식 투표·우수팀 투표는 그대로 둡니다.
create or replace function public.wc_leave(p_knox_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v text := lower(btrim(coalesce(p_knox_id, '')));
begin
  update public.participants
     set joined_at = null, last_seen = null
   where knox_id = v;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.wc_leave(text) from public;
grant execute on function public.wc_leave(text) to anon, authenticated, service_role;
