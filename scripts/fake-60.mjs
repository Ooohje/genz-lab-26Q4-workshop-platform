// 가짜 참여자 60명이 단어를 보내는 테스트 스크립트 (Node 18 이상, 설치할 것 없음)
//
//   node scripts/fake-60.mjs                 60명이 약 40초에 걸쳐 보냄
//   node scripts/fake-60.mjs --people 30 --seconds 15
//   node scripts/fake-60.mjs --code genz
//
// 실제 DB에 단어가 들어갑니다. 끝나면 관리 화면의 "모두 지우기"로 지우세요.

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const arg = (name, fallback) => {
  const i = process.argv.indexOf("--" + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};

// config.js 에서 주소와 공개 키를 읽습니다.
const configText = readFileSync(new URL("../config.js", import.meta.url), "utf8");
const pick = (key) => (configText.match(new RegExp(key + '\\s*:\\s*"([^"]+)"')) || [])[1];
const URL_BASE = pick("supabaseUrl");
const KEY = pick("supabaseKey");
const CODE = arg("code", pick("sessionCode"));
const PEOPLE = Number(arg("people", 60));
const SECONDS = Number(arg("seconds", 40));

const headers = { apikey: KEY, "Content-Type": "application/json" };

// 앞쪽 단어일수록 자주 나옵니다. 같은 뜻의 다른 표기·문장형도 섞어 AI 정리를 시험합니다.
const POOL = [
  "연결", "성장", "공감", "도전", "자유", "재미", "신뢰", "다양성", "용기", "존중", "소통",
  "여유", "협업", "변화", "희망", "지속가능", "배움", "안전", "상상", "실험", "따뜻함", "솔직함",
  "균형", "건강", "쉼", "창의", "기회", "공정", "돌봄", "환대", "응원", "모험", "호기심", "진심",
  "자립", "이웃", "마을", "웃음", "평화", "포용", "느슨한 연대", "워라밸", "책임", "꾸준함", "몰입",
  "영감", "취향", "경청", "나눔", "회복", "행복", "열정", "꿈", "자기다움", "유연함", "함께", "시작",
  "믿음", "설렘", "선한 영향력", "칭찬", "든든함", "온기", "놀이",
  "서로 연결되기", "함께 성장하기", "같이 성장", "소통하는 팀", "연 결", "Growth", "growth",
];
const pickWord = () => POOL[Math.floor(Math.pow(Math.random(), 2.2) * POOL.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sRes = await fetch(`${URL_BASE}/rest/v1/sessions?code=eq.${encodeURIComponent(CODE)}&select=id,question,is_open`, { headers });
const [session] = await sRes.json();
if (!session) {
  console.error(`세션 '${CODE}' 을(를) 찾지 못했습니다.`);
  process.exit(1);
}
console.log(`세션: ${CODE} · "${session.question}" · ${session.is_open ? "응답 받는 중" : "마감됨"}`);
console.log(`${PEOPLE}명이 약 ${SECONDS}초 동안 보냅니다…`);

let ok = 0, fail = 0;
const failures = new Map();

async function person(n) {
  const client_id = randomUUID();
  await sleep(Math.random() * SECONDS * 1000 * 0.8);
  const rounds = Math.random() < 0.3 ? 2 : 1; // 열 명 중 세 명은 한 번 더 보냄
  for (let r = 0; r < rounds; r++) {
    const count = 1 + Math.floor(Math.random() * 4);
    const words = [...new Set(Array.from({ length: count }, pickWord))];
    const res = await fetch(`${URL_BASE}/rest/v1/words`, {
      method: "POST",
      headers,
      body: JSON.stringify(words.map((word) => ({ session_id: session.id, word, client_id }))),
    });
    if (res.ok) ok += words.length;
    else {
      fail += words.length;
      const msg = (await res.text()).slice(0, 120);
      failures.set(msg, (failures.get(msg) || 0) + 1);
    }
    if (r + 1 < rounds) await sleep(2000 + Math.random() * SECONDS * 200);
  }
  if (n % 10 === 0) console.log(`  … ${n}번째 참여자 전송`);
}

const started = Date.now();
await Promise.all(Array.from({ length: PEOPLE }, (_, i) => person(i + 1)));
console.log(`\n끝: 성공 ${ok}개 · 실패 ${fail}개 · ${((Date.now() - started) / 1000).toFixed(1)}초`);
for (const [msg, n] of failures) console.log(`  실패 ${n}건: ${msg}`);
if (fail && !session.is_open) console.log("  (세션이 마감 상태라 추가가 막힌 것은 정상입니다.)");
