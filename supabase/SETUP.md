# Supabase 설정 순서

Supabase 대시보드에서 위에서 아래로 따라 하면 됩니다. 15분 정도 걸립니다.

> **절대 다른 사람(채팅 포함)에게 보내면 안 되는 것**: DB 비밀번호, `service_role`/secret 키, Gemini API 키, 관리자 비밀번호.
> 프론트 코드에 넣어도 되는 것은 **Project URL**과 **anon(publishable) 키** 두 개뿐입니다.

## 0. 프로젝트 만들기

| 항목 | 값 |
|---|---|
| Project name | `genz-wordcloud` (아무 이름이나 가능) |
| Database password | "Generate a password"로 만들고 비밀번호 관리자에 저장 |
| Region | Northeast Asia (Seoul) |
| Enable Data API | 체크 |
| Automatically expose new tables | **체크 해제** |
| Enable automatic RLS | 체크 |

## 1. 테이블·RLS·Realtime 만들기

1. 왼쪽 메뉴 **SQL Editor** → **New query**
2. [`schema.sql`](schema.sql) 내용을 전부 복사해 붙여 넣고 **Run**
3. "Success. No rows returned"가 나오면 완료입니다. (위험한 작업 경고 창이 뜨면 `drop policy`, `revoke` 때문이니 실행해도 됩니다.)

확인:

- **Table Editor**에 `sessions`, `words` 두 테이블이 보이고, `sessions`에 코드가 `genz`인 줄이 하나 있어야 합니다.
- **Database → Publications → supabase_realtime**에 `sessions`, `words`가 켜져 있어야 합니다.

이 SQL이 하는 일:

- `sessions`: 접속 코드, 질문, 열림/닫힘, AI 정리 결과(대표 단어 묶음)
- `words`: 세션, 단어, 정규화된 단어(공백 제거·소문자, 자동 계산), 숨김 여부, 시각
- 익명 사용자는 `sessions` 읽기, `words` 읽기·추가만 가능. 수정·삭제는 불가
- 세션이 닫혀 있으면 추가 불가, 단어는 15자까지(DB 제약), 한 사람당 30개까지
- 숨긴 단어도 익명 읽기 권한으로는 조회됩니다. 화면에서 걸러서 안 보여 주는 방식입니다

## 2. Gemini API 키 받기

1. <https://aistudio.google.com/apikey> 접속 → **Create API key**
2. 키를 복사해 둡니다. (다음 단계에서 Supabase secrets에만 넣습니다.)
3. 모델은 따로 고르지 않아도 됩니다. 함수가 잘 묶는 모델(`gemini-3.8-flash`)과 빠른 모델(`gemini-3.5-flash-lite`)을 동시에 부르고,
   잘 묶는 모델이 15초 안에 답하면 그 결과를, 늦으면 빠른 모델의 결과를 씁니다.
   잘 묶는 쪽을 다른 모델로 바꾸고 싶을 때만 3단계에서 `GEMINI_MODEL`로 지정하세요.

## 3. Secrets 넣기

왼쪽 메뉴 **Edge Functions → Secrets**에서 추가합니다.

| 이름 | 값 |
|---|---|
| `ADMIN_PASSWORD` | 관리 화면에 들어갈 비밀번호 (직접 정하기, 12자 이상 권장) |
| `GEMINI_API_KEY` | 2단계에서 받은 키 |
| `GEMINI_MODEL` | (선택) 기본값과 다른 모델을 쓸 때만 |

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 Supabase가 자동으로 넣어 주므로 추가하지 않습니다.

## 4. Edge Function 배포

1. **Edge Functions → Deploy a new function → Via Editor**
2. 함수 이름을 **`admin`** 으로 입력
3. 편집기의 기본 코드를 지우고 [`functions/admin/index.ts`](functions/admin/index.ts) 내용을 전부 붙여 넣기
4. **Deploy function**
5. 배포된 `admin` 함수의 **Details(설정)** 에서 **Verify JWT** 를 **끄고** 저장
   - 이 함수는 JWT 대신 `ADMIN_PASSWORD`로 직접 확인합니다. 켜 두면 새 방식의 publishable 키로 호출할 때 401이 날 수 있습니다.

## 5. 동작 확인

`[프로젝트ID]`와 `[비밀번호]`를 바꿔서 터미널에서 실행합니다. (프로젝트 ID는 Project URL `https://[프로젝트ID].supabase.co`의 앞부분)

```bash
curl -s -X POST "https://[프로젝트ID].supabase.co/functions/v1/admin" -H "Content-Type: application/json" -d '{"password":"[비밀번호]","code":"genz","action":"verify"}'
```

- `{"ok":true,"session":{...}}` → 정상
- `{"error":"비밀번호가 올바르지 않습니다"}` → `ADMIN_PASSWORD` 값 확인
- 401에 `Invalid JWT`/`Missing authorization header` → 4-5의 Verify JWT가 아직 켜져 있음
- 500에 `supabaseKey is required` → 자동 secret 이름이 바뀐 경우입니다. 알려 주시면 코드를 고치겠습니다

AI 정리와 단어 추가·마감 차단은 3단계에서 화면을 붙인 뒤 60명분 테스트 스크립트(4단계)로 함께 확인합니다.

## 6. 프론트에 넣을 값 두 개 확인

**Project Settings → API Keys**(또는 상단 **Connect** 버튼)에서:

- **Project URL**: `https://[프로젝트ID].supabase.co`
- **anon / publishable 키**: `eyJ...` 또는 `sb_publishable_...`

이 두 값은 공개되어도 되는 값이라 3단계에서 `config.js`에 넣습니다.

## 관리자 함수가 받는 동작

모두 `POST /functions/v1/admin`, 본문에 `password`, `code`, `action`을 넣습니다.

| action | 추가 값 | 하는 일 |
|---|---|---|
| `verify` | – | 비밀번호 확인 |
| `set_question` | `question` (1~100자) | 질문 변경 |
| `set_open` | `open` (true/false) | 응답 시작/마감 |
| `hide_word` | `normalized`, `hidden` | 같은 단어를 한꺼번에 숨김/다시 보임 |
| `ai_summary` | – | 숨기지 않은 단어를 Gemini로 묶어 `sessions.ai_groups`에 저장 |
| `clear_ai` | – | AI 정리 결과를 지우고 원본으로 |
| `reset` | – | 받은 단어와 AI 정리 결과 전부 삭제 |

## 무료 플랜에서 알아 둘 점

- 7일 동안 사용이 없으면 프로젝트가 일시정지됩니다. **워크샵 전날 대시보드에 들어가 깨어 있는지 확인**하세요.
- Realtime 동시 접속 한도는 200명이라 60명 규모에는 충분합니다.
- Gemini 무료 구간은 분당·하루 호출 수 제한이 있습니다. AI 정리는 버튼을 누를 때 한 번만 호출하므로 평소엔 문제없지만, 당일 아침에 AI Studio에서 한도를 확인하세요.
