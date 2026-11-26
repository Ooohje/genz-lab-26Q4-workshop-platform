-- =====================================================================
-- Gen Z Lab. 워크샵 플랫폼 — 워드클라우드 답변 길이를 15자에서 30자로
-- schema.sql 을 예전(15자 제한)에 실행한 프로젝트에 "추가로" 실행합니다.
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run 하세요. 여러 번 실행해도 안전합니다.
-- =====================================================================

do $$
declare
  c record;
begin
  -- words.word 의 글자 수 제약을 이름과 상관없이 찾아 지웁니다.
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.words'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%char_length%word%'
  loop
    execute format('alter table public.words drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.words add constraint words_word_check
  check (char_length(btrim(word)) between 1 and 30);
