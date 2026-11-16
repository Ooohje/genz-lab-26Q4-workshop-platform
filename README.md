# GenZ Lab 워크샵 실시간 워드클라우드

참여자가 스마트폰으로 단어를 보내면 프로젝터 화면에 워드클라우드가 실시간으로 그려지는 웹앱입니다.
60명 안팎의 워크샵을 기준으로 만들었습니다.

![발표 화면](docs/screenshots/screen.jpg)

## 접속 주소

| 화면 | 누가 | 주소 |
|---|---|---|
| 참여 (join) | 참여자 · 스마트폰 | <https://ooohje.github.io/genz-lab-Word-Cloud/> |
| 발표 (screen) | 프로젝터 · 전체화면(F11) | <https://ooohje.github.io/genz-lab-Word-Cloud/screen.html> |
| 관리 (admin) | 진행자 · 노트북 | <https://ooohje.github.io/genz-lab-Word-Cloud/admin.html> |

참여 주소는 발표 화면의 QR코드로도 열 수 있고, Knox 메신저로 링크를 공유해도 됩니다.

## 화면

| 참여 | 관리 |
|---|---|
| <img src="docs/screenshots/join.jpg" width="260" alt="참여 화면"> | <img src="docs/screenshots/admin.jpg" width="560" alt="관리 화면"> |

- **참여**: 로그인·이름 없이 익명. 단어 입력칸 2개가 기본이고 "단어 추가"로 늘립니다(한 단어 15자, 한 사람 30개까지). 보낸 단어는 칩으로 쌓이고 계속 추가할 수 있습니다. 마감되면 입력이 닫힙니다.
- **발표**: 많이 나온 단어일수록 크고 굵게, 가운데에 놓입니다. 새 단어는 떠오르며 나타나고, 같은 단어가 또 들어오면 커지면서 살짝 튕깁니다. 아직 단어가 없으면 QR이 중앙에 크게 보입니다.
- **AI 정리**: 관리 화면에서 실행하면 "소통·이야기 나누기·대화"처럼 흩어진 표현을 Gemini가 대표 단어로 묶고, 발표 화면이 그 단어들로 다시 그려집니다. 화면 아무 곳이나 누르면 원본으로 돌아가고, 왼쪽 아래 ✦ 버튼으로 다시 볼 수 있습니다.
- **관리**: 비밀번호로 들어갑니다. 질문 변경, 응답 시작/마감, 단어 숨기기, AI 정리, 초기화.

![관리자 비밀번호 화면](docs/screenshots/admin-login.jpg)

## 구성

```
index.html      참여 화면          js/join.js
screen.html     발표 화면          js/screen.js   (d3-cloud 배치)
admin.html      관리 화면          js/admin.js
config.js       Supabase 주소와 공개 키 (이 파일만 고치면 됩니다)
css/style.css   공통 스타일
assets/         배경, 로고, 캐릭터, 파비콘
supabase/       schema.sql · functions/admin/index.ts · SETUP.md
scripts/        fake-60.mjs (가짜 참여자 60명 테스트)
```

- 프론트: 빌드 없는 정적 HTML/CSS/JS → GitHub Pages
- 백엔드: Supabase 무료 플랜 (Postgres + Realtime + Edge Function)
- AI: Gemini API 무료 구간. 키는 Supabase secrets에만 있고 Edge Function에서만 호출합니다. 프론트 코드에는 없습니다.
- 같은 단어는 공백 제거·소문자 기준으로 합칩니다(`연 결` = `연결`, `Growth` = `growth`).

## 처음 설정하기

1. **Supabase**: [supabase/SETUP.md](supabase/SETUP.md)를 위에서부터 따라 합니다(테이블, secrets, Edge Function).
2. **config.js**: Project URL과 anon(publishable) 키를 넣습니다. 이 두 값은 공개되어도 됩니다.
3. **GitHub Pages**: 아래 "배포" 참고.

## 배포

이 저장소는 `gh-pages` 브랜치를 GitHub Pages로 내보냅니다. 고친 뒤 두 브랜치에 모두 올리면 1~2분 안에 반영됩니다.

```bash
git add -A
```

```bash
git commit -m "변경 내용"
```

```bash
git push origin main
```

```bash
git push origin main:gh-pages
```

Pages 설정을 바꾸려면 저장소 **Settings → Pages**에서 Source를 "Deploy from a branch", 브랜치를 `gh-pages` / `(root)`로 둡니다.

Edge Function(`supabase/functions/admin/index.ts`)을 고쳤을 때는 GitHub에 올리는 것만으로는 반영되지 않습니다. Supabase 대시보드 **Edge Functions → admin → Code**에 새 코드를 붙여 넣고 Deploy 해야 합니다.

## 테스트: 가짜 참여자 60명

Node 18 이상이면 설치 없이 실행됩니다. 발표 화면을 띄워 놓고 돌리면 단어가 쌓이는 모습을 볼 수 있습니다.

```bash
node scripts/fake-60.mjs
```

```bash
node scripts/fake-60.mjs --people 30 --seconds 15
```

실제 DB에 단어가 들어갑니다. 끝나면 관리 화면의 **모두 지우기**로 지우세요.

서버 없이 관리 화면 모양만 보려면 `admin.html?demo=1`을 엽니다(저장되지 않는 미리보기).

## 워크샵 당일 체크리스트

**전날**

- [ ] Supabase 대시보드에 들어가 프로젝트가 **깨어 있는지** 확인 (무료 플랜은 7일간 사용이 없으면 일시정지됩니다. "Restore"를 누르면 몇 분 걸립니다)
- [ ] 관리 화면에 비밀번호로 들어가지는지 확인
- [ ] `node scripts/fake-60.mjs`로 발표 화면에 단어가 쌓이는지 확인
- [ ] **AI 정리 실행**을 한 번 눌러 결과가 나오는지 확인
- [ ] [AI Studio 한도 페이지](https://aistudio.google.com/rate-limit)에서 **Gemini 무료 한도**가 남아 있는지 확인
- [ ] 관리 화면에서 **모두 지우기**로 테스트 단어 삭제
- [ ] 워크샵 질문을 입력하고 저장

**당일, 시작 전**

- [ ] 행사장 네트워크(와이파이·사내망)에서 세 화면이 모두 열리는지 확인. `supabase.co`, `github.io`, `cdn.jsdelivr.net`이 막혀 있으면 동작하지 않습니다
- [ ] 스마트폰 한 대로 QR을 찍어 단어 하나를 보내 보고, 발표 화면에 뜨면 **모두 지우기**
- [ ] 프로젝터에 발표 화면을 띄우고 F11로 전체화면
- [ ] 관리 화면은 진행자 노트북에 따로 열어 두기 (프로젝터에 비밀번호가 비치지 않게)
- [ ] 응답 받기가 **켜져** 있는지 확인
- [ ] Knox 메신저에 참여 링크 공유

**진행 중**

- 부적절한 단어는 관리 화면 단어 목록에서 **숨기기**
- 충분히 모이면 **응답 받기**를 끄고 **AI 정리 실행**
- 다음 질문으로 넘어갈 때: 모두 지우기 → 질문 저장 → 응답 받기 켜기

**문제가 생기면**

| 증상 | 확인할 것 |
|---|---|
| 발표 화면에 새 단어가 안 뜸 | 새로고침. 20초마다 자동으로 다시 맞추므로 잠시 기다려도 됩니다 |
| "세션을 불러오지 못했어요" | Supabase 프로젝트가 일시정지됐는지, `config.js` 값이 맞는지 |
| 참여자가 "보내지 못했어요" | 응답 받기가 꺼져 있는지, 한 사람 30개 한도를 넘었는지 |
| AI 정리 실패 | 관리 화면에 뜨는 오류 문구 확인. 한도 초과면 잠시 뒤 다시 실행 |

## 알아 둘 점

- 숨긴 단어는 화면에서 걸러서 안 보이게 하는 방식이라, 익명 키로 API를 직접 호출하면 조회됩니다.
- 참여 인원은 브라우저마다 만든 임의 번호로 셉니다. 같은 사람이 다른 브라우저로 들어오면 두 명으로 세어집니다.
- 관리자 비밀번호는 Supabase secrets의 `ADMIN_PASSWORD`입니다. 바꾸려면 대시보드에서 값을 바꾸면 됩니다.
