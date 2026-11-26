// raid: 오프닝 보스 레이드 (픽셀 캐릭터 → 조 내 공유 → 연습 → 보스 레이드 → 최종 순위).
// 워크샵 플랫폼의 세 화면이 이 모듈을 함께 씁니다. 각 화면은 Shadow DOM 안에 그려서 플랫폼 CSS(css/style.css)와 섞이지 않습니다(css/raid.css).
//   관리 화면(admin.html)  '보스 레이드' 탭 = 진행 · '레이드 설정' 탭 = 보스·규칙·문구·연습 보스·룰렛. 관리자 비밀번호를 그대로 씁니다.
//   참여 화면(index.html)  메인 관제가 '보스 레이드'일 때 내 휴대폰 화면. 워크샵에 입장한 Knox ID로 자동 입장.
//   발표 화면(screen.html) 메인 관제가 '보스 레이드'일 때 프로젝터 화면 + BGM(js/raid-sim-bgm.js).
// 진행·판정은 Supabase 데이터베이스 함수(supabase/raid-sim.sql)가 하고 Realtime 으로 모든 화면에 옵니다. 진행 버튼은 Edge Function raid-sim.
// admin.html?demo=1 에서는 서버 없이 js/raid-sim-engine.js 로 이 브라우저 안에서만 동작합니다(휴대폰 미리보기 포함).
window.WCRaid = (function () {
  "use strict";
  // 이 파일의 버전 (index·admin·screen.html 의 js/raid.js?v= 와 같게). 새로 올릴 때마다 바꾸면 브라우저 캐시 대신 새 파일을 받습니다.
  const V = "20261126b";
  // 참여 주소 (발표 화면 첫 페이지 QR)
  const JOIN_URL = window.WC && window.WC.joinUrl ? window.WC.joinUrl() : new URL("./", location.href).href;
  // 발표 화면에 크게 보여 줄 주소: 설정의 "짧은 참여 주소"가 있으면 그것, 없으면 실제 주소에서 https:// 를 뗀 것
  const joinText = () => (RULES.joinShort || JOIN_URL).replace(/^https?:\/\//, "").replace(/\/$/, "");

  const STATS = [
    { key: "hp", label: "체력", desc: "오래 버티는 힘, 몸으로 밀어붙이는 추진력", color: "#E0694E" },
    { key: "intel", label: "지력", desc: "분석하고 정리하고 구조를 짜는 힘", color: "#4A6FD0" },
    { key: "social", label: "친화력", desc: "사람을 연결하고 분위기를 만드는 힘", color: "#2E9E6B" },
    { key: "mental", label: "멘탈", desc: "압박과 변수 앞에서 흔들리지 않는 힘", color: "#8A63D2" },
    { key: "luck", label: "운", desc: "예상 못 한 변수가 내 편이 되는 힘", color: "#C98A1B" },
  ];
  // 게임 규칙 (진행자가 "보스·규칙 설정" 탭에서 바꿈). Supabase(또는 js/raid-sim-engine.js)가 보내 줍니다.
  const DEFAULT_RULES = { statTotal: 25, statMin: 1, statMax: 10, rerolls: 2, meetingSec: 180, practiceMeetingSec: 60, shareMin: 8, mvpBonus: 1, luckPower: 35 };
  let RULES = Object.assign({}, DEFAULT_RULES);
  const KEYS = STATS.map((s) => s.key);
  const LABEL = Object.fromEntries(STATS.map((s) => [s.key, s.label]));
  const COLOR = Object.fromEntries(STATS.map((s) => [s.key, s.color]));
  let TEAM_NAMES = ["A조", "B조"];   // 조 이름 (명단이 있으면 명단의 조)
  let TEAMS = TEAM_NAMES.slice();     // 화면(HTML)에 바로 넣는 조 이름 (이스케이프됨)
  let JOIN_MODE = "seats";            // "roster": 휴대폰에서 아이디로 입장 · "seats": 6자리 중 고르기
  // 보스 정보는 Supabase(또는 js/raid-sim-engine.js)가 보내 줍니다. 판정 스탯은 결과 공개 전까지 진행자에게만 옵니다.
  let BOSSES = [];
  let PRACTICE = null;
  let STORY_DRAFTS = {};   // 회의 중에 미리 쓴 AI 서술 (진행자에게만 옴)   // 연습 보스 (0번 라운드)
  // 돌발 이벤트 룰렛: 칸마다 효과(kind, value), 문구는 효과대로 자동 (판정은 js/raid-sim-engine.js · supabase/raid-sim.sql)
  const SPIN_KINDS = [["power", "공격력 ±N"], ["clear", "격파하면 +N점"], ["fail", "실패해도 +N점"], ["none", "효과 없음"]];
  const effLabel = (e) => !e ? "" : e.kind === "power" ? "공격력 " + sign(e.value) : e.kind === "clear" ? "격파하면 " + sign(e.value) + "점" : e.kind === "fail" ? "실패해도 " + sign(e.value) + "점" : "효과 없음";
  const effGood = (e) => !!e && e.kind !== "none" && e.value > 0;
  const spinRules = () => (RULES.roulette || []).map(effLabel).join(" · ");

  // ── 픽셀 캐릭터 (16×18) ─────────────────────────────────────
  // 스탯으로 정해지는 것: 옷(1위 스탯) · 손에 든 소품(2위) · 표정(꼴찌) · 반짝이 · 볼터치
  // 랜덤(seed, "외형 랜덤 뽑기"로 바뀜): 피부 · 머리 색 · 머리 모양 · 액세서리 · 액세서리 색 · 신발 색
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function () { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const SKINS = ["#FBE3CF", "#F9D7B9", "#F1C29A", "#E0A87E", "#C68A5E", "#8D5A3B"];
  const HAIR_COLORS = ["#2B2238", "#4A2F24", "#7A4A2A", "#C8902F", "#B5473D", "#5B4BC4", "#2F4BA8", "#BFC3D2", "#E97FA8", "#2E8F86", "#E8C76A"];
  const HAIR_STYLES = ["short", "bob", "spiky", "part", "bun", "long", "buzz", "mohawk", "pigtails", "curly", "ponytail", "sidebang"];
  // 액세서리 (none 이 두 번 = 아무것도 없는 캐릭터도 꽤 나옴)
  const ACCS = ["none", "none", "cap", "beanie", "ribbon", "headband", "flower", "headphones", "earring", "bandaid", "freckles"];
  const ACC_COLORS = [["#F4775C", "#C9573F"], ["#5B7FD6", "#3F5FB0"], ["#2E9E6B", "#1F7A50"], ["#8A63D2", "#6A47B0"], ["#FFC23D", "#D9A21B"], ["#E97FA8", "#C95F88"]];
  const SHOES = ["#2B2F4A", "#2B2F4A", "#E0694E", "#F2F4FB", "#5B4BC4", "#2E9E6B", "#8A5A3B"];
  const TITLES = { "hp+intel": "야근하는 설계자", "hp+social": "회식의 분위기 메이커", "hp+mental": "불굴의 현장러", "intel+social": "회의실의 조율자", "intel+mental": "냉철한 전략가", "social+mental": "사내 상담소장",
    "hp+luck": "버티다 보면 터지는 행운아", "intel+luck": "찍어도 맞히는 분석가", "social+luck": "인복 터진 마당발", "mental+luck": "흔들려도 운으로 버티는 사람" };
  function parts(c) {
    const r = rng(c.seed);
    const tie = KEYS.map(() => r());
    const order = KEYS.map((k, i) => ({ k, v: Number(c[k]) || 0, t: tie[i] })).sort((a, b) => b.v - a.v || b.t - a.t).map((x) => x.k);
    return { top: order[0], second: order[1], low: order[order.length - 1], sparkle: (Number(c[order[0]]) || 0) >= 8, blush: (Number(c.social) || 0) >= 7,
      skin: SKINS[Math.floor(r() * SKINS.length)], hairColor: HAIR_COLORS[Math.floor(r() * HAIR_COLORS.length)], hairStyle: HAIR_STYLES[Math.floor(r() * HAIR_STYLES.length)],
      acc: ACCS[Math.floor(r() * ACCS.length)], accColor: ACC_COLORS[Math.floor(r() * ACC_COLORS.length)], shoes: SHOES[Math.floor(r() * SHOES.length)] };
  }
  function title(c) {
    const avg = KEYS.reduce((n, k) => n + (Number(c[k]) || 0), 0) / KEYS.length;
    if (KEYS.every((k) => Math.abs((Number(c[k]) || 0) - avg) <= 1)) return "만능 올라운더";
    const p = parts(c);
    return TITLES[KEYS.filter((k) => k === p.top || k === p.second).join("+")];
  }
  function sprite(c) {
    const p = parts(c), out = [];
    const px = (x, y, w, h, f) => out.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + f + '"/>');
    const OL = "#1F2540", H = p.hairColor, S = p.skin, MOUTH = "#9C4A3F", GOLD = "#FFC23D";
    if (p.sparkle) { px(1, 0, 1, 3, GOLD); px(0, 1, 3, 1, GOLD); px(15, 9, 1, 1, GOLD); px(1, 13, 1, 1, GOLD); px(14, 0, 1, 1, GOLD); }
    if (p.hairStyle === "long") px(2, 4, 12, 9, H);
    px(3, 2, 10, 9, OL); px(4, 3, 8, 7, S);
    switch (p.hairStyle) {
      case "short": px(4, 1, 8, 1, OL); px(3, 2, 10, 2, H); px(3, 4, 1, 2, H); px(12, 4, 1, 2, H); break;
      case "bob": px(4, 1, 8, 1, OL); px(3, 2, 10, 2, H); px(3, 4, 2, 6, H); px(11, 4, 2, 6, H); break;
      case "spiky": px(3, 2, 10, 2, H); [3, 5, 7, 9, 11].forEach((x) => px(x, 1, 1, 1, H)); px(3, 4, 1, 1, H); px(12, 4, 1, 1, H); break;
      case "part": px(4, 1, 8, 1, OL); px(3, 2, 10, 2, H); px(3, 4, 4, 1, H); px(3, 5, 1, 2, H); px(12, 4, 1, 2, H); break;
      case "bun": px(4, 1, 8, 1, OL); px(6, 0, 4, 2, H); px(3, 2, 10, 2, H); px(3, 4, 1, 2, H); px(12, 4, 1, 2, H); break;
      case "long": px(4, 1, 8, 1, OL); px(3, 2, 10, 2, H); px(3, 4, 1, 3, H); px(12, 4, 1, 3, H); break;
      case "mohawk": px(4, 1, 8, 1, OL); px(3, 2, 10, 1, H); px(6, 0, 4, 1, H); px(7, 1, 2, 2, H); break;
      case "pigtails": px(4, 1, 8, 1, OL); px(3, 2, 10, 2, H); px(3, 4, 1, 1, H); px(12, 4, 1, 1, H); px(1, 3, 2, 4, H); px(13, 3, 2, 4, H); px(1, 7, 1, 1, H); px(14, 7, 1, 1, H); break;
      case "curly": px(3, 1, 10, 3, H); [3, 5, 7, 9, 11].forEach((x) => px(x, 0, 2, 1, H)); px(2, 3, 2, 5, H); px(12, 3, 2, 5, H); px(4, 4, 1, 1, H); px(11, 4, 1, 1, H); break;
      case "ponytail": px(4, 1, 8, 1, OL); px(3, 2, 10, 2, H); px(3, 4, 1, 2, H); px(12, 4, 1, 2, H); px(13, 2, 2, 2, H); px(14, 4, 1, 5, H); break;
      case "sidebang": px(4, 1, 8, 1, OL); px(3, 2, 10, 2, H); px(3, 4, 6, 1, H); px(3, 5, 3, 1, H); px(12, 4, 1, 2, H); break;
      default: px(4, 1, 8, 1, OL); px(3, 2, 10, 1, H);
    }
    if (p.low === "social") { px(5, 6, 2, 1, OL); px(9, 6, 2, 1, OL); px(6, 8, 4, 1, MOUTH); }
    else {
      px(6, 6, 1, 1, OL); px(9, 6, 1, 1, OL);
      if (p.low === "hp") { px(6, 7, 1, 1, "#A99BD6"); px(9, 7, 1, 1, "#A99BD6"); px(7, 8, 2, 1, MOUTH); }
      else if (p.low === "intel") { px(7, 8, 2, 1, MOUTH); px(13, 0, 3, 1, "#F4775C"); px(15, 1, 1, 1, "#F4775C"); px(14, 2, 1, 1, "#F4775C"); px(14, 4, 1, 1, "#F4775C"); }
      else if (p.low === "mental") { px(6, 9, 1, 1, MOUTH); px(7, 8, 2, 1, MOUTH); px(9, 9, 1, 1, MOUTH); px(13, 4, 1, 1, "#7FC8F8"); px(13, 5, 1, 2, "#7FC8F8"); }
      else { px(7, 8, 2, 1, MOUTH); px(12, 0, 3, 1, "#9AA3BF"); px(13, 1, 1, 1, "#7FC8F8"); px(14, 2, 1, 1, "#7FC8F8"); }
    }
    if (p.blush) { px(5, 8, 1, 1, "#F4A6A6"); px(10, 8, 1, 1, "#F4A6A6"); }
    const OUTFIT = { hp: ["#E0694E", "#B9503A"], intel: ["#F2F4FB", "#C9CEE0"], social: ["#F7B7C8", "#E48FA7"], mental: ["#5B5F7A", "#454962"], luck: ["#FFC23D", "#D9A21B"] };
    const [main, shade] = OUTFIT[p.top];
    px(3, 11, 10, 5, main); px(4, 16, 8, 1, main); px(4, 12, 1, 4, shade); px(11, 12, 1, 4, shade);
    px(3, 16, 1, 1, S); px(12, 16, 1, 1, S); 
    if (p.top === "hp") { px(8, 11, 1, 6, "#FBE0D9"); px(3, 11, 1, 5, "#FFFFFF"); px(12, 11, 1, 5, "#FFFFFF"); px(3, 4, 10, 1, "#E0694E"); }
    else if (p.top === "intel") { px(7, 11, 2, 4, "#2F4BA8"); px(5, 11, 2, 1, "#FFFFFF"); px(9, 11, 2, 1, "#FFFFFF"); px(5, 5, 2, 1, OL); px(9, 5, 2, 1, OL); px(7, 6, 2, 1, OL); if (p.low !== "social") { px(5, 6, 1, 1, "#BFD3FF"); px(10, 6, 1, 1, "#BFD3FF"); } }
    else if (p.top === "social") { [5, 7, 9].forEach((x) => px(x, 13, 1, 1, "#FFFFFF")); [6, 8, 10].forEach((x) => px(x, 15, 1, 1, "#FFFFFF")); }
    else if (p.top === "mental") { px(6, 11, 1, 2, "#FFFFFF"); px(9, 11, 1, 2, "#FFFFFF"); px(6, 14, 4, 2, shade); px(3, 1, 10, 1, "#3A3F5C"); px(2, 5, 2, 3, "#F4775C"); px(12, 5, 2, 3, "#F4775C"); }
    else { [[7, 12], [9, 12], [7, 14], [9, 14]].forEach(([x, y]) => px(x, y, 1, 1, "#2E9E6B")); px(8, 13, 1, 1, "#1F7A50"); px(12, 2, 1, 1, "#FFFFFF"); }
    if (p.second === "hp") { px(13, 11, 2, 1, "#9AA3BF"); px(13, 12, 2, 5, "#2E9E6B"); px(13, 13, 2, 1, "#D6EFE3"); }
    else if (p.second === "intel") { px(12, 13, 4, 4, "#C7CCDD"); px(12, 13, 4, 1, "#9AA3BF"); px(13, 15, 2, 1, "#FFFFFF"); }
    else if (p.second === "social") { px(12, 13, 2, 1, "#6B4A2E"); px(14, 13, 2, 1, "#6B4A2E"); px(12, 14, 2, 3, "#FFFFFF"); px(14, 14, 2, 3, "#FFFFFF"); px(12, 15, 2, 1, "#C98A1B"); px(14, 15, 2, 1, "#C98A1B"); }
    else if (p.second === "mental") { px(14, 12, 1, 3, "#2E9E6B"); px(13, 13, 1, 1, "#2E9E6B"); px(15, 13, 1, 1, "#2E9E6B"); px(13, 15, 3, 2, "#C2462B"); }
    else { px(13, 13, 3, 3, "#FFFFFF"); px(13, 13, 3, 1, "#E6E8F0"); px(14, 14, 1, 1, "#1F2540"); }
    // 신발 색 (랜덤)
    px(5, 17, 2, 1, p.shoes); px(9, 17, 2, 1, p.shoes);
    // 액세서리 (랜덤). 스탯 옷과 겹치는 조합은 건너뜀 (멘탈 1위는 이미 헤드폰·머리띠, 체력 1위는 이미 땀 밴드)
    const [A, A2] = p.accColor, acc = p.acc;
    if (acc === "cap") { px(4, 0, 8, 1, A); px(3, 1, 10, 2, A); px(1, 3, 7, 1, A2); px(7, 1, 2, 1, "#FFFFFF"); }
    else if (acc === "beanie") { px(7, 0, 2, 1, "#FFFFFF"); px(4, 1, 8, 1, A); px(3, 2, 10, 1, A); px(3, 3, 10, 1, A2); }
    else if (acc === "ribbon") { px(2, 1, 2, 3, A); px(5, 1, 2, 3, A); px(4, 2, 1, 1, A2); }
    else if (acc === "headband" && p.top !== "mental" && p.top !== "hp") { px(3, 3, 10, 1, A); px(10, 2, 2, 1, A2); }
    else if (acc === "flower") { px(3, 2, 1, 3, A); px(2, 3, 3, 1, A); px(3, 3, 1, 1, "#FFE36E"); }
    else if (acc === "headphones" && p.top !== "mental") { px(3, 0, 10, 1, "#3A3F5C"); px(2, 1, 1, 3, "#3A3F5C"); px(13, 1, 1, 3, "#3A3F5C"); px(1, 4, 2, 3, A); px(13, 4, 2, 3, A); }
    else if (acc === "earring") { px(2, 7, 1, 1, "#FFC23D"); px(2, 8, 1, 1, A); }
    else if (acc === "bandaid") { px(9, 7, 3, 1, "#F2C7A0"); px(10, 7, 1, 1, "#E3A97C"); }
    else if (acc === "freckles") { px(5, 7, 1, 1, "#B77A55"); px(4, 8, 1, 1, "#B77A55"); px(10, 7, 1, 1, "#B77A55"); px(11, 8, 1, 1, "#B77A55"); }
    return '<svg viewBox="0 0 16 18" shape-rendering="crispEdges" aria-hidden="true" style="display:block;width:100%;height:100%">' + out.join("") + "</svg>";
  }
  const BOSS_ART = ["..h......h..", "..hh....hh..", ".XXXXXXXXXX.", "XXXXXXXXXXXX", "XXwwXXXXwwXX", "XXwkXXXXwkXX", "XXXXXXXXXXXX", "XXmmmmmmmmXX", "XXmtmtmtmtXX", ".XXXXXXXXXX.", ".XX..XX..XX."];
  const BOSS_COLORS = ["#5B7FD6", "#8A63D2", "#2E9E6B", "#E0694E", "#1F2540"];
  function bossSprite(round) {
    const body = round === 0 ? "#4FB0A5" : BOSS_COLORS[(round - 1) % 5];
    const fill = { X: body, h: round >= 5 ? "#FFC23D" : body, w: "#FFFFFF", k: "#1F2540", m: "#3A1F2B", t: "#FFFFFF" };
    let out = "";
    BOSS_ART.forEach((row, y) => [...row].forEach((ch, x) => { if (fill[ch]) out += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + fill[ch] + '"/>'; }));
    return '<svg class="boss-art" viewBox="0 0 12 11" shape-rendering="crispEdges" aria-hidden="true">' + out + "</svg>";
  }
  const auraOf = (c) => COLOR[parts(c).top];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const statsText = (keys) => (keys ? keys.map((k) => LABEL[k]).join(" + ") : "비공개");
  const rand = (n) => Math.floor(Math.random() * n);
  // 규칙(합계·최소·최대)에 맞는 랜덤 스탯 / 캐릭터를 안 만든 사람의 기본 스탯
  function randomStats() {
    const a = KEYS.map(() => RULES.statMin);
    for (let left = RULES.statTotal - RULES.statMin * KEYS.length; left > 0; left--) { let i; do { i = rand(KEYS.length); } while (a[i] >= RULES.statMax); a[i]++; }
    return Object.fromEntries(KEYS.map((k, i) => [k, a[i]]));
  }
  const defaultStats = () => Object.fromEntries(KEYS.map((k, i) => [k, Math.floor(RULES.statTotal / KEYS.length) + (i < RULES.statTotal % KEYS.length ? 1 : 0)]));
  const blankDraft = () => Object.fromEntries(KEYS.map((k) => [k, RULES.statMin]));
  const sign = (n) => (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n);
  const diceText = (x) => x.effect ? "룰렛 " + effLabel(x.effect) : "";
  const qrCache = {};
  function qrSvg(text) {
    if (qrCache[text]) return qrCache[text];
    try { const q = window.qrcode(0, "M"); q.addData(text); q.make(); return (qrCache[text] = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true })); } catch (e) { return ""; }
  }

  // ── 상태: Supabase 가 보내 주는 그대로 그립니다 ───────────────────
  let MODE = "loading";     // "supabase" | "local"
  let isHost = false;       // 판정 스탯까지 받는 관리 화면인지 (관리자 비밀번호 확인 뒤)
  let hostError = "";
  let connected = false;
  let clockOffset = 0;      // 서버 시각 - 이 기기 시각 (타이머 보정)
  const ready = { state: false, people: false };
  let game = null;          // 진행 상태와 결과
  const people = {};        // 자리 (이름, 조, 캐릭터)
  const picks = {};         // r{라운드}t{조} → {pid, by, auto}
  const drafts = {};        // 휴대폰마다 고치는 중인 스탯 (저장 전, 이 기기에만)
  const editing = {};
  let myPid = null, myName = null, myKnox = null, loginState = "", loginSig = "";
  const now = () => Date.now() + clockOffset;
  const CFG = window.WORDCLOUD_CONFIG || null;
  let SB = null;            // Supabase 클라이언트 (플랫폼 것을 같이 씀)
  let getPassword = () => null;
  let setupError = "";
  const toast = (msg) => { if (window.WC && window.WC.toast) window.WC.toast(msg); };
  // fresh: 방금 만든 상태라서 서버 시각으로 이 기기 시계를 보정해도 되는지
  function apply(snap, fresh) {
    if (!snap || !snap.people) return;
    game = snap.game;
    if (game) game.results = game.results || {};
    Object.keys(people).forEach((k) => delete people[k]);
    Object.values(snap.people || {}).forEach((p) => { people[p.id] = p; });
    Object.keys(picks).forEach((k) => delete picks[k]);
    Object.assign(picks, snap.picks || {});
    BOSSES = snap.bosses || [];
    PRACTICE = snap.practice || null;
    STORY_DRAFTS = snap.storyDrafts || {};
    TEAM_NAMES = Array.isArray(snap.teams) && snap.teams.length ? snap.teams.map(String) : ["A조", "B조"];
    TEAMS = TEAM_NAMES.map((t) => esc(t));
    JOIN_MODE = snap.mode === "roster" ? "roster" : "seats";
    RULES = Object.assign({}, DEFAULT_RULES, snap.config || {});
    if (fresh && snap.now) clockOffset = snap.now - Date.now();
    ready.state = ready.people = true;
    render();
  }

  // Supabase: 진행자 동작은 raid-sim Edge Function 으로 (비밀번호 확인)
  async function callAdmin(op, arg, data) {
    const res = await fetch(CFG.supabaseUrl + "/functions/v1/raid-sim", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: CFG.supabaseKey, Authorization: "Bearer " + CFG.supabaseKey },
      body: JSON.stringify({ password: getPassword(), op, arg: arg == null ? null : arg, data: data == null ? null : data }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) { const e = new Error(j.error || (res.status === 404 ? "raid-sim Edge Function 을 먼저 배포해 주세요" : "진행자 요청 실패 (" + res.status + ")")); e.status = res.status; throw e; }
    return j.view;
  }
  async function hostAct(fn, arg, data) {
    try { const v = await callAdmin(fn, arg, data); isHost = true; hostError = ""; apply(v, true); return true; }
    catch (e) {
      if (!isHost) { hostError = e.message; invalidate(); }
      toast(e.message); return false;
    }
  }
  // 진행자 화면은 공개 상태가 바뀔 때마다 판정 스탯이 든 상태를 다시 받습니다 (몰리면 한 번만).
  let hostRefreshTimer = null, hostRefreshing = false, hostRefreshAgain = false;
  function refreshHost() {
    clearTimeout(hostRefreshTimer);
    hostRefreshTimer = setTimeout(async () => {
      if (hostRefreshing) { hostRefreshAgain = true; return; }
      hostRefreshing = true;
      try { apply(await callAdmin("state"), true); } catch (e) { /* 다음 변경 때 다시 */ }
      hostRefreshing = false;
      if (hostRefreshAgain) { hostRefreshAgain = false; refreshHost(); }
    }, 120);
  }
  function onPublic(data, fresh) {
    connected = true;
    if (isHost) { if (fresh && data && data.now) clockOffset = data.now - Date.now(); refreshHost(); }
    else apply(data, fresh);
  }
  // Supabase: 참여자 동작은 공개 키로 데이터베이스 함수를 바로 부릅니다.
  async function playerAct(pid, a, data) {
    try {
      const { data: r, error } = await SB.rpc("raid_sim_act", { p_pid: pid, p_action: a, p_data: data || {} });
      if (error) throw error;
      if (!r || !r.ok) { toast((r && r.error) || "처리하지 못했어요"); return false; }
      return true;
    } catch (e) { toast("저장하지 못했어요. 인터넷 연결을 확인해 주세요."); return false; }
  }
  // 명단으로 만든 판: 아이디 → 내 자리 { ok, pid } 또는 { error }
  async function loginId(uid) {
    if (MODE === "supabase") {
      try {
        const { data: r, error } = await SB.rpc("raid_sim_login", { p_uid: uid });
        if (error) throw error;
        return r || {};
      } catch (e) { return { error: "입장하지 못했어요. 인터넷 연결을 확인해 주세요." }; }
    }
    const r = LOCAL.engine.login(LOCAL.S, uid);
    setTimeout(() => apply(LOCAL.engine.snapshot(LOCAL.S, true), true), 0);
    return r.error ? { ok: false, error: r.error } : { ok: true, pid: r.pid, name: r.name };
  }
  // 파일 모드: 같은 규칙을 이 브라우저 안에서 돌립니다.
  let LOCAL = null;
  function runLocal(fn) {
    const err = fn(LOCAL.engine, LOCAL.S);
    if (err) toast(err);
    setTimeout(() => apply(LOCAL.engine.snapshot(LOCAL.S, true), true), 0);
    return !err;
  }
  const backend = {
    host: (fn, arg, data) => MODE === "supabase" ? hostAct(fn, arg, data) : runLocal((E, S) => E.host(S, fn, arg, data)),
    act: (pid, a, data) => MODE === "supabase" ? playerAct(pid, a, data) : runLocal((E, S) => E.act(S, pid, a, data)),
  };

  // ── 화면 계산용 (판정은 Supabase 가 합니다) ──
  const personList = () => Object.keys(people).map(Number).sort((a, b) => a - b).map((i) => people[i]);
  const teamOf = (t) => personList().filter((p) => p.team === t);
  const boss = () => (game.round === 0 ? PRACTICE : BOSSES[game.round - 1]) || {};
  const isPractice = () => !!game && game.stage === "boss" && game.round === 0 && game.phase !== "idle";
  const rname = () => (game.round === 0 ? "연습" : "보스 " + game.round);
  const rlabel = () => (game.round === 0 ? "연습 라운드 · 점수에 안 들어가요" : "보스 " + game.round + " / " + BOSSES.length);
  // 출전자의 판정 스탯 값 (예: 체력 6 + 멘탈 5)
  const statLine = (x, b) => (b.stats || []).map((k) => LABEL[k] + " " + (charOf(people[x.pid] || {})[k] ?? "?")).join(" + ");
  const pickOf = (r, t) => picks["r" + r + "t" + t];
  // before 라운드 전까지 몇 번 출전했는지 (연습 라운드는 세지 않음)
  function plays(pid, before) {
    let n = 0;
    for (let r = 1; r < before; r++) for (let t = 0; t < TEAMS.length; t++) { const k = pickOf(r, t); if (k && k.pid === pid) n++; }
    return n;
  }
  // 출전 제한: 한 사람 최대 2번, 조원이 6명 미만인 조는 3번 (js/raid-sim-engine.js · supabase/raid-sim.sql 과 같음)
  const MAX_PLAYS = 2, SMALL_TEAM = 6, SMALL_MAX_PLAYS = 3;
  const capOf = (t) => (teamOf(t).length < SMALL_TEAM ? SMALL_MAX_PLAYS : MAX_PLAYS);
  // 2) 명단 판에서는 아이디로 입장한 사람만 출전 후보 (6자리 연습판은 모두)
  const present = (m) => JOIN_MODE !== "roster" || !!(m && m.claimed);
  // 고를 수 있는 사람: 입장했고 출전 횟수가 남은 사람. 입장한 조원이 모두 다 썼으면 그중 가장 적게 나간 사람
  function canPick(pid, t) {
    if (!present(people[pid])) return false;
    const r = game.round, cap = capOf(t), n = plays(pid, r);
    if (n < cap) return true;
    const mates = teamOf(t).filter(present).map((m) => plays(m.id, r));
    return !mates.some((x) => x < cap) && n === Math.min(...mates);
  }
  const charOf = (p) => p.char || Object.assign(defaultStats(), { seed: p.seed || 1, isDefault: true });
  function scoreboard() {
    const res = game.results || {};
    const counted = Object.keys(res).map(Number).filter((r) => r >= 1 && (r < game.round || (r === game.round && (game.phase === "revealed" || game.phase === "final"))));
    const rows = TEAMS.map((_, t) => {
      let total = 0, power = 0, cleared = 0;
      counted.forEach((r) => { const x = (res[r] || []).find((y) => y.team === t); if (x) { total += x.points || 0; power += x.power || 0; cleared += x.cleared ? 1 : 0; } });
      return { team: t, total, power, cleared };
    }).sort((a, b) => b.total - a.total || b.cleared - a.cleared || a.team - b.team);
    // 순위: 총점 → 격파 횟수. 둘 다 같으면 같은 등수
    rows.forEach((x, i) => { x.rank = i && rows[i - 1].total === x.total && rows[i - 1].cleared === x.cleared ? rows[i - 1].rank : i + 1; });
    return rows;
  }

  function hostButtons() {
    const b = [], add = (label, fn, cls) => b.push({ label, fn, cls });
    if (!ready.state || !isHost) return b;
    if (!game || !personList().length) { add("게임 준비하기", "setup", "go"); return b; }
    if (game.stage === "lobby") add("캐릭터 만들기 시작", "make", "go");
    else if (game.stage === "make") { add("조 내 공유로 넘기기", "share", "go"); add("안 만든 사람 랜덤 생성", "fillChars"); }
    else if (game.stage === "share") { add("보스 레이드로 넘기기", "raid", "go"); add("안 만든 사람 랜덤 생성", "fillChars"); }
    else if (game.phase === "idle") { add("연습 보스 시작", "start:0", "go"); add("연습 없이 1번 보스 시작", "start:1"); }
    else if (game.phase === "meeting") { add("마감하기", "close", "go"); if (!game.hint) add("힌트 공개", "hint"); }
    else if (game.phase === "closed") { if (boss().event) add("룰렛 돌리기", "roll", "go"); else add("결과 공개", "reveal", "go"); add(game.round ? game.round + "라운드 다시" : "연습 다시", "start:" + game.round); }
    else if (game.phase === "rolled") { add("결과 공개", "reveal", "go"); add(game.round ? game.round + "라운드 다시" : "연습 다시", "start:" + game.round); }
    else if (game.phase === "revealed" && game.round === 0) {
      if (game.view === 1) { add("1번 보스 시작 (본게임)", "start:1", "go"); add("공격력 화면", "reveal:0"); }
      else { add("점수표 보기", "reveal:1", "go"); add("1번 보스 시작 (본게임)", "start:1"); }
      add("연습 다시", "start:0");
    }
    else if (game.phase === "revealed") {
      // 결과 화면 3장: reveal:0 공격력 · reveal:1 점수표 · reveal:2 중간 집계 (3라운드마다 중간 집계를 먼저 권함)
      const v = game.view || 0, last = game.round >= BOSSES.length, mid = game.round % 3 === 0 && !last;
      const next = () => add((game.round + 1) + "번 보스 시작", "start:" + (game.round + 1), "go");
      if (v === 0) { add("점수표 보기", "reveal:1", "go"); if (!last) add((game.round + 1) + "번 보스 시작", "start:" + (game.round + 1)); }
      else if (v === 1) { if (last) add("최종 순위", "final", "go"); else if (mid) { add("중간 집계 보기", "reveal:2", "go"); add((game.round + 1) + "번 보스 시작", "start:" + (game.round + 1)); } else { next(); add("중간 집계 보기", "reveal:2"); } add("공격력 화면", "reveal:0"); }
      else { if (last) add("최종 순위", "final", "go"); else next(); add("점수표로", "reveal:1"); }
      if (!last || v === 0) add("최종 순위", "final");
    }
    if (game.stage !== "lobby") add("← 이전 단계", "back", "quiet");
    add("처음부터", "reset", "quiet");
    return b;
  }
  const stepWord = () => !game ? "준비 전" : game.stage === "lobby" ? "대기" : game.stage === "make" ? "1. 캐릭터 만들기" : game.stage === "share" ? "2. 조 내 공유"
    : game.phase === "idle" ? "3. 보스 레이드 규칙" : game.phase === "meeting" ? rname() + " · 회의" : game.phase === "closed" ? rname() + " · 마감" : game.phase === "rolled" ? rname() + " · 룰렛"
    : game.phase === "revealed" ? rname() + " · " + (game.view === 1 ? "점수표" : game.round && game.view === 2 ? "중간 집계" : "결과") : "최종 순위";

  // ── 참여자 동작 (스탯 고르기는 이 기기에서, 저장·외형 랜덤 뽑기·출전자 선택은 Supabase 로) ──
  async function personAct(pid, a, extra) {
    const p = people[pid];
    if (!p || !game) return;
    const d = drafts[pid] || (drafts[pid] = blankDraft());
    if (a === "inc" || a === "dec") {
      const used = KEYS.reduce((n, k) => n + d[k], 0);
      if (a === "inc" && d[extra] < RULES.statMax && used < RULES.statTotal) d[extra]++;
      if (a === "dec" && d[extra] > RULES.statMin) d[extra]--;
      render();
    } else if (a === "randomDraft") { drafts[pid] = randomStats(); render(); }
    else if (a === "save") { if (await backend.act(pid, "save", { stats: d })) { editing[pid] = false; render(); } }
    else if (a === "edit") { editing[pid] = true; drafts[pid] = Object.fromEntries(KEYS.map((k) => [k, Number.isInteger(p.char[k]) ? p.char[k] : RULES.statMin])); render(); }
    else if (a === "cancel") { editing[pid] = false; render(); }
    else if (a === "reroll") backend.act(pid, "reroll");
    else if (a === "pick") {
      const m = people[extra], k = pickOf(game.round, p.team), cur = k ? people[k.pid] : null;
      if (!m || (cur && cur.id === m.id)) return;
      if (!confirm(cur ? "출전자를 " + cur.name + " 님에서 " + m.name + " 님으로 바꿀까요?" : m.name + " 님을 이번 라운드 출전자로 정할까요?")) return;
      backend.act(pid, "pick", { m: extra });
    }
  }
  // 참여 화면: 워크샵에 입장한 Knox ID 로 보스 레이드 자리를 찾습니다 (명단은 관리 화면 '명단 · 조' 그대로).
  // 명단이 바뀌어 못 찾았으면 명단이 바뀔 때마다 다시 찾아봅니다.
  async function ensureLogin() {
    if (!myKnox || !game || loginState === "busy") return;
    const sig = personList().map((p) => p.name).join("|");
    if (loginState === "none" && loginSig === sig) return;
    loginState = "busy"; loginSig = sig;
    const r = await loginId(myKnox);
    if (r && r.ok) { myPid = r.pid; myName = r.name || null; loginState = ""; if (people[myPid]) people[myPid].claimed = true; }
    else { myPid = null; loginState = "none"; }
    invalidate();
  }

  // ── 돌발 이벤트 룰렛 ──────────────────────────────────────────
  // 진행자가 "룰렛 돌리기"를 누른 시각(rollAt)부터 ROLL_MS 동안 모든 화면에서 같이 돌고(점점 느려짐), 그 뒤 각 조의 칸이 나옵니다.
  const ROLL_MS = 3000;
  const rolling = () => !!game && game.phase === "rolled" && now() - (game.rollAt || 0) < ROLL_MS;
  function reel(x) {
    const L = RULES.roulette || [];
    if (rolling()) return '<div class="reel spinning"><span data-reel>' + esc(effLabel(L[rand(L.length)])) + "</span></div>";
    return '<div class="reel done' + (effGood(x.effect) ? " good" : "") + '"><span>' + esc(effLabel(x.effect)) + "</span></div>";
  }
  // 도는 동안: 칸 문구가 차례로 바뀌고, 끝에 가까울수록 느려짐
  setInterval(() => {
    if (!rolling()) return;
    const L = (RULES.roulette || []).map(effLabel), p = Math.min(1, (now() - game.rollAt) / ROLL_MS), gap = 60 + 420 * p * p * p, t = Date.now();
    if (!L.length) return;
    qsaAll("[data-reel]").forEach((el) => {
      if (t - (Number(el.dataset.t) || 0) < gap) return;
      const i = ((el.dataset.i != null ? Number(el.dataset.i) : rand(L.length)) + 1) % L.length;
      el.dataset.i = i; el.dataset.t = t; el.textContent = L[i];
    });
  }, 30);
  let rollTimer = null;
  function scheduleRollEnd() {
    clearTimeout(rollTimer);
    if (rolling()) rollTimer = setTimeout(() => { invalidate(); }, Math.max(50, ROLL_MS - (now() - game.rollAt)) + 60);
  }
  // 휴대폰 결과 카드의 AI 서술: 오기 전에는 로딩 칸, 오면 같은 자리에 문장. 45초가 지나도 안 오면 칸을 거둠
  const storyWait = {};
  function storyBox(x) {
    if (x.story) return '<div class="story">' + esc(x.story) + "</div>";
    const k = game.round + "|" + x.pid + ":" + x.power;
    if (!storyWait[k]) { storyWait[k] = Date.now(); setTimeout(invalidate, 45500); }
    if (Date.now() - storyWait[k] > 45000) return "";
    return '<div class="story loading" role="status"><span class="spark-ai">✦</span>AI가 이번 판을 풀이하는 중<span class="dots"><i>.</i><i>.</i><i>.</i></span></div>';
  }
  // 우리 조 결과 문장 (휴대폰에만): 몇 점 모자랐는지, 받은 점수
  function myResultLine(x, b) {
    if (game.round === 0) return (x.cleared ? "보스 HP " + b.hp + " 돌파 → 격파!" : "보스 HP " + b.hp + "까지 " + (b.hp - x.power) + "점 부족") + " · 연습이라 점수에는 안 들어가요";
    const out = [x.cleared ? "보스 HP " + b.hp + " 돌파 → 격파 +" + b.reward + "점" : "보스 HP " + b.hp + "까지 " + (b.hp - x.power) + "점 부족 → 0점"];
    if (x.extra) out.push("룰렛 " + sign(x.extra) + "점");
    if (x.mvp) out.push("MVP +" + RULES.mvpBonus + "점");
    return out.join(" · ");
  }

  // ── 화면 ────────────────────────────────────────────────────────
  function left(ms) { if (!(ms > 0)) return "0:00"; const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
  function tick() {
    qsaAll("[data-deadline]").forEach((el) => { const ms = Number(el.dataset.deadline) - now(); el.textContent = left(ms); el.classList.toggle("urgent", ms < 20000); });
  }
  setInterval(tick, 500);

  const SAMPLE_CHARS = [{ hp: 9, intel: 3, social: 6, mental: 3, luck: 4, seed: 11 }, { hp: 2, intel: 9, social: 3, mental: 6, luck: 5, seed: 27 }, { hp: 5, intel: 3, social: 9, mental: 4, luck: 4, seed: 5 },
    { hp: 3, intel: 6, social: 2, mental: 9, luck: 5, seed: 42 }, { hp: 4, intel: 5, social: 6, mental: 1, luck: 9, seed: 64 }];
  // 설정 탭의 문구: **굵게**, 줄바꿈 그대로
  const richText = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
  const defaultRulesTitle = () => "보스 " + BOSSES.length + "명이 기다리고 있어요";
  const defaultRuleLines = () => [
    "먼저 **연습 보스**와 한 판 해 봐요. 연습은 점수와 출전 기록에 들어가지 않아요.",
    "보스는 총 **" + BOSSES.length + "판**. 라운드마다 조에서 **1명**이 출전해요. 한 사람은 **최대 " + MAX_PLAYS + "번**까지 나갈 수 있어요(조원이 " + SMALL_TEAM + "명 미만인 조는 **" + SMALL_MAX_PLAYS + "번**).",
    "판정 스탯은 **비공개**. 보스 설명을 보고 조원과 추리해서 출전자를 고르세요.",
    "공격력(판정 스탯 합)이 **보스 HP 이상이면 격파** → 그 보스의 보상 점수(" + rewardRange() + "), **실패하면 0점**.",
    "라운드 공격력 1위 조는 **MVP " + sign(RULES.mvpBonus) + "점** (격파 못 해도, 동점이면 모두).",
    "결과 공개 전에 **돌발 이벤트**가 터질 수도 있어요. 그때는 **룰렛**에 걸린 칸에 따라 공격력이나 점수가 바뀌어요.",
    "몇 라운드마다 **중간 집계**로 조별 점수를 함께 보고, **최종 순위는 마지막에 공개**돼요.",
  ];
  const rewardRange = () => { const r = BOSSES.map((b) => b.reward); return !r.length ? "" : Math.min(...r) === Math.max(...r) ? r[0] + "점" : Math.min(...r) + "~" + Math.max(...r) + "점"; };
  function projHtml() {
    if (!game) return '<div class="pv pv-center"><div class="h">보스 레이드 시뮬레이터</div><div class="sub">진행자 화면에서 "게임 준비하기"를 눌러 주세요</div></div>';
    const qr = '<div class="pv-qr glass"><div class="q">' + qrSvg(JOIN_URL) + '</div><span>휴대폰으로 QR을 찍거나<br>주소를 입력해 참여<b class="addr">' + esc(joinText()) + "</b></span></div>";
    if (game.stage === "lobby") {
      const joined = personList().filter((p) => p.claimed).length;
      return '<div class="pv pv-center"><div class="eyebrow">오프닝 아이스브레이킹</div><div class="h">' + (RULES.lobbyTitle ? richText(RULES.lobbyTitle) : '나만의 <span class="title-glow">픽셀 캐릭터</span><br>&amp; 보스 레이드') + '</div><div class="sub">' + (RULES.lobbySub ? richText(RULES.lobbySub) : "휴대폰으로 QR을 찍거나 아래 주소를 입력하고, Knox ID로 입장해 주세요") + "</div>" +
        '<div class="lobby-row"><div class="pv-qr glass big"><div class="q">' + qrSvg(JOIN_URL) + '</div><span>QR을 찍거나 주소를 입력해 참여</span></div><div class="count glass"><span>입장</span><b>' + joined + "</b><span>/ " + personList().length + "명</span></div></div>" +
        '<div class="join-addr glass"><span>주소</span><b>' + esc(joinText()) + "</b></div></div>";
    }
    if (game.stage === "make") {
      const made = personList().filter((p) => p.char && !p.char.isDefault).length;
      return '<div class="pv"><div class="h">나만의 픽셀 캐릭터를 만들어 주세요</div><div class="sub">스탯 ' + KEYS.length + "개에 " + RULES.statTotal + "점을 나눠요 · 스탯 하나는 " + RULES.statMin + "~" + RULES.statMax + '점 · 외형은 스탯에 따라 자동으로 생겨요</div>' +
        '<div class="stat-cards">' + STATS.map((s, i) => '<div class="stat-card glass" style="--c:' + s.color + '"><div class="art">' + sprite(SAMPLE_CHARS[i]) + "</div><b>" + s.label + "</b><span>" + esc(s.desc) + "</span></div>").join("") + "</div>" +
        '<div class="pv-foot"><div class="count glass"><span>캐릭터 완성</span><b>' + made + "</b><span>/ " + personList().length + "명</span></div>" + qr + "</div></div>";
    }
    if (game.stage === "share") return '<div class="pv"><div class="h">조원에게 내 캐릭터를 소개해 주세요</div><div class="sub">휴대폰에서 우리 조 캐릭터 카드를 함께 보세요</div>' +
      '<ol class="qs"><li><b>내 칭호</b>와, 그 칭호가 맞는지 아닌지</li><li><b>가장 높은 스탯</b>: 이 점수를 준 에피소드 하나</li><li><b>가장 낮은 스탯</b>: 솔직한 고백 한 마디</li></ol>' +
      '<div class="timer glass" style="margin-top:auto;align-self:flex-end" data-deadline="' + game.shareDeadline + '"></div></div>';
    if (game.phase === "idle") return '<div class="pv pv-center"><div class="eyebrow">보스 레이드</div><div class="h">' + richText(RULES.rulesTitle || defaultRulesTitle()) + '</div><div class="glass rules-box"><ol class="rules">' +
      ((RULES.rulesLines && RULES.rulesLines.length) ? RULES.rulesLines : defaultRuleLines()).map((x) => "<li>" + richText(x) + "</li>").join("") + "</ol></div></div>";
    const b = boss();
    const head = '<div class="boss-row glass">' + bossSprite(game.round) + '<div><div class="eyebrow">' + rlabel() + '</div><div class="boss-name">' + esc(b.name) + '</div><div class="boss-desc">' + esc(b.desc) + "</div>" +
      '<div class="chips"><span class="hpc">HP ' + b.hp + "</span>" + (game.round === 0 ? "<span>연습</span>" : "<span>보상 " + b.reward + "점</span>") + (b.nStats > 2 ? "<span>판정 스탯 " + b.nStats + "개</span>" : "") + "</div></div></div>";
    if (game.phase === "meeting") {
      const n = TEAMS.filter((_, t) => pickOf(game.round, t)).length;
      return '<div class="pv">' + head + '<div class="meet-foot">' +
        (game.hint ? '<div class="hint glass"><em>힌트</em>' + esc(b.hint) + "</div>" : '<div class="hint glass"><em>회의</em>판정 스탯을 추리하고 출전자를 골라 주세요</div>') +
        '<div class="timer glass" data-deadline="' + game.deadline + '"></div><div class="mini-count glass"><span>출전자 확정</span><b>' + n + "</b><span>/ " + TEAMS.length + "</span></div></div>" +
        "</div>";
    }
    const rows = game.results[game.round] || [];
    if (game.phase === "closed") {
      return '<div class="pv"><div class="h">마감! ' + (game.round === 0 ? "연습 라운드" : "이번 라운드") + ' 출전자</div><div class="sub">' + esc(b.name) + " · 보스 HP " + b.hp + '</div><div class="fighters' + (rows.length > 12 ? " many dense" : rows.length > 4 ? " many" : "") + '"' + (rows.length <= 4 ? ' style="grid-template-columns:repeat(' + rows.length + ',minmax(0,1fr))"' : "") + ">" +
        rows.map((x) => '<div class="fighter glass"><div class="art">' + sprite(charOf(people[x.pid] || {})) + "</div><div><span>" + TEAMS[x.team] + (x.auto ? " · 랜덤" : "") + "</span><b>" + esc(x.name) + "</b></div></div>").join("") + "</div></div>";
    }
    if (game.phase === "rolled") {
      return '<div class="pv"><div><div class="eyebrow">' + esc(b.name) + '</div><div class="h ev-alert">!! 돌발 이벤트 발생 !!</div>' +
        '<div class="sub">룰렛 칸: ' + esc(spinRules()) + "</div></div>" +
        '<div class="dice-grid' + (rows.length > 12 ? " many dense" : rows.length > 4 ? " many" : "") + '" style="--n:' + (rows.length > 12 ? 7 : Math.min(rows.length, 6)) + '">' + rows.map((x) =>
          '<div class="dice-team glass"><div class="dwho">' + TEAMS[x.team] + "<b>" + esc(x.name) + "</b></div>" + reel(x) + "</div>").join("") + "</div></div>";
    }
    if (game.phase === "revealed") {
      const sorted = rows.slice().sort((a, c) => a.team - c.team);
      const view = game.round === 0 && game.view === 2 ? 0 : game.view || 0;   // 연습은 중간 집계 없음
      // 2장: 이번 라운드 점수표 (격파 몇 조 · 실패 몇 조 · 조마다 얻은 점수와 내역)
      if (view === 1) {
        const win = rows.filter((x) => x.cleared).length;
        return '<div class="pv' + (rows.length > 4 ? " many" : "") + '"><div class="reveal-head"><div class="eyebrow">' + esc(b.name) + " · " + rlabel() + '</div><div class="h score-h">이번 라운드 점수</div>' +
          '<div class="tally"><span class="tw">격파 성공 <b>' + win + '</b>조</span><span class="tl">실패 <b>' + (rows.length - win) + "</b>조</span><span>" + (game.round === 0 ? "연습 라운드" : "보상 " + b.reward + "점 · MVP " + sign(RULES.mvpBonus) + "점") + "</span>" +
          (rows.some((x) => x.effect && (x.effect.kind === "clear" || x.effect.kind === "fail")) ? '<span class="roul-key"><b></b>룰렛 결과</span>' : "") + "</div></div>" +
          '<div class="score-grid glass' + (rows.length > 6 ? " cols" : "") + '" style="--rows:' + (rows.length > 6 ? Math.ceil(rows.length / 2) : rows.length) + '">' +
          sorted.map((x) => '<div class="sc-row' + (x.cleared ? " win" : "") + '"><b class="sc-team">' + TEAMS[x.team] + '</b><span class="sc-name">' + esc(x.name) + "</span>" +
            '<span class="sc-out">' + (x.cleared ? "격파" : "실패") + '</span><span class="sc-parts">' + scoreParts(x, b) + '</span><b class="sc-pt">' + (game.round === 0 ? "—" : "+" + x.points + "점") + "</b></div>").join("") + "</div></div>";
      }
      // 3장: 중간 집계 (지금까지의 조별 총점)
      if (view === 2) return standingsHtml("중간 집계 · " + game.round + "라운드까지", "이번 라운드에 얻은 점수는 오른쪽에 따로 보여요. 최종 순위는 마지막에 공개돼요.");
      // 1장: 공격력과 승패. 모든 조의 게이지가 동시에 올라가고(0.8초 뒤부터 2.6초), 다 찬 뒤 실패한 캐릭터가 자기 칸 안에서 쓰러집니다 (CSS)
      const max = Math.max(b.hp + 4, ...rows.map((x) => x.power));
      return '<div class="pv' + (rows.length > 4 ? " many" : "") + '"><div class="reveal-head"><div class="eyebrow">' + esc(b.name) + ' · 판정 스탯' + (game.round === 0 ? ' <span class="practice-tag">연습</span>' : "") + '</div><div class="reveal-stats">' + statsText(b.stats) + '</div><div class="sub">' + esc(b.reveal) + "</div></div>" +
        '<div class="bars glass' + (rows.length > 6 ? " cols" + (rows.length > 14 ? " dense" : "") : rows.length > 4 ? " many" : "") + '" style="--hp:' + (b.hp / max * 100) + "%;--rows:" + Math.ceil(rows.length / 2) + '"><div class="hp-note"><i></i>보스 HP ' + b.hp + " · 점선을 넘으면 격파" +
        (rows.some((x) => x.effect && x.effect.kind === "power") ? '<span class="roul-key"><b></b>룰렛 결과</span>' : "") + "</div>" +
        sorted.map((x) => '<div class="bar-row' + (x.cleared ? " win" : " lose") + '"><div class="art">' + sprite(charOf(people[x.pid] || {})) + '</div><div class="nm"><b>' + TEAMS[x.team] + "</b><span>" + esc(x.name) + "</span></div>" +
          '<div class="mid"><div class="track"><i style="width:' + (Math.max(0, x.power) / max * 100) + '%"></i><em class="spark" style="left:' + (Math.max(0, x.power) / max * 100) + '%"></em></div>' +
          '<em class="stv">' + esc(statLine(x, b)) + (x.effect && x.effect.kind === "power" ? ' <span class="roul">' + esc(effLabel(x.effect)) + "</span>" : "") + "</em></div>" +
          '<div class="res"><b>' + x.power + "</b><span>" + (x.cleared ? "격파" : "실패") + (x.mvp && game.round !== 0 ? ' <span class="star">MVP</span>' : "") + "</span></div></div>").join("") + "</div></div>";
    }
    if (TEAMS.length > 3) {
      return '<div class="pv"><div class="h" style="text-align:center">보스 레이드 최종 순위</div><div class="rank-list glass" style="--rows:' + Math.ceil(TEAMS.length / 2) + '">' +
        scoreboard().map((x) => '<div class="rk' + (x.rank === 1 ? " top" : "") + '"><b>' + x.rank + "위</b><span>" + TEAMS[x.team] + "</span><span>" + x.total + "점 · 격파 " + x.cleared + "회</span></div>").join("") + "</div></div>";
    }
    return '<div class="pv"><div class="h" style="text-align:center">보스 레이드 최종 순위</div><div class="podium" style="grid-template-columns:repeat(' + TEAMS.length + ',1fr)">' +
      scoreboard().slice().sort((a, c) => (a.rank === 1 ? 1 : 0) - (c.rank === 1 ? 1 : 0) || c.rank - a.rank).map((x) => '<div class="r' + x.rank + '"><b>' + TEAMS[x.team] + "</b><span>" + x.total + "점 · 격파 " + x.cleared + '회</span><div class="block glass">' + x.rank + "위</div></div>").join("") + "</div></div>";
  }

  // 점수표 한 줄의 내역: 격파 보상 · MVP · 룰렛(다른 색)
  function scoreParts(x, b) {
    const out = game.round === 0 ? [] : [x.cleared ? "격파 +" + b.reward : "격파 0"];
    if (x.mvp) out.push(game.round === 0 ? "공격력 1위" : "MVP " + sign(RULES.mvpBonus));
    let h = out.map((t) => "<span>" + t + "</span>").join("");
    // 룰렛: 점수 효과(격파하면·실패해도)만 점수표에. 공격력 효과는 1장(공격력 화면)에만
    if (x.effect && (x.effect.kind === "clear" || x.effect.kind === "fail")) {
      const pts = x.extra ? " → " + sign(x.extra) + "점" : " → 해당 없음";
      h += '<span class="roul">' + esc(effLabel(x.effect)) + pts + "</span>";
    }
    return h;
  }
  // 중간 집계: 지금까지의 총점 순위 + 이번 라운드에 얻은 점수
  function standingsHtml(title, note) {
    const sb = scoreboard(), top = Math.max(1, ...sb.map((x) => x.total)), cur = game.results[game.round] || [];
    return '<div class="pv"><div class="reveal-head"><div class="eyebrow">보스 레이드 · ' + game.round + " / " + BOSSES.length + '라운드</div><div class="h score-h">' + esc(title) + '</div><div class="sub">' + esc(note) + "</div></div>" +
      '<div class="stand glass' + (sb.length > 6 ? " cols" : "") + '" style="--rows:' + (sb.length > 6 ? Math.ceil(sb.length / 2) : sb.length) + '">' +
      sb.map((x) => { const r = cur.find((y) => y.team === x.team);
        return '<div class="st-row' + (x.rank === 1 ? " top" : "") + '"><b class="st-rank">' + x.rank + '위</b><b class="st-team">' + TEAMS[x.team] + "</b>" +
          '<div class="st-bar"><i style="width:' + Math.max(0, x.total) / top * 100 + '%"></i></div><b class="st-pt">' + x.total + "점</b>" +
          '<span class="st-sub">격파 ' + x.cleared + "회" + (r ? ' · <em>이번 +' + r.points + "</em>" : "") + "</span></div>"; }).join("") + "</div></div>";
  }

  // 진행자용 팀별 점수 현황: 순위 · 총점 · 격파 횟수 · 라운드별 점수 (결과 공개된 본게임 라운드만)
  function hostScoreHtml() {
    const res = game.results || {};
    const rounds = Object.keys(res).map(Number).filter((r) => r >= 1 && (r < game.round || (r === game.round && (game.phase === "revealed" || game.phase === "final")))).sort((a, c) => a - c);
    let h = '<div class="score-now"><div class="between"><b>팀별 점수 현황</b><span class="small">' + (rounds.length ? rounds[rounds.length - 1] + "라운드까지 · " : "") + "진행자에게만 보여요</span></div>";
    if (!rounds.length) return h + '<div class="small">1번 보스 결과를 공개하면 여기에 점수가 쌓여요.</div></div>';
    h += '<div class="tbl-scroll"><table class="res-table"><thead><tr><th>순위</th><th>조</th><th class="n">총점</th><th class="n">격파</th>' +
      rounds.map((r) => '<th class="n" title="' + esc((BOSSES[r - 1] || {}).name || "") + '">' + r + "R</th>").join("") + "</tr></thead><tbody>";
    scoreboard().forEach((x) => {
      h += "<tr><td><b>" + x.rank + "위</b></td><td><b>" + TEAMS[x.team] + '</b></td><td class="n"><b>' + x.total + '</b></td><td class="n">' + x.cleared + "</td>" +
        rounds.map((r) => { const y = (res[r] || []).find((z) => z.team === x.team); return '<td class="n' + (y && y.cleared ? " ok" : "") + '">' + (y ? (y.points || 0) + (y.mvp ? "★" : "") : "") + "</td>"; }).join("") + "</tr>";
    });
    return h + '</tbody></table></div><div class="small">빨간 숫자 = 격파한 라운드 · ★ = MVP · 순위는 총점, 같으면 격파 횟수</div></div>';
  }

  function adminHtml() {
    if (!isHost) return '<p class="small">' + esc(hostError || "관리자 비밀번호로 확인하는 중이에요…") + "</p>";
    if (!game || !personList().length) return '<p class="small">위의 "게임 준비하기"를 누르면 워크샵 명단(명단 · 조 탭, Chief Crew 조 제외)으로 보스 레이드 판이 만들어져요.</p>';
    let html = "";
    if (game.stage !== "boss" || game.phase === "idle") {
      html += '<div class="secret">판정 스탯은 여기에만 보여요.<br>' + (PRACTICE ? "연습. " + esc(PRACTICE.name) + " → <b>" + statsText(PRACTICE.stats) + "</b> · HP " + PRACTICE.hp + "<br>" : "") +
        BOSSES.map((b, i) => (i + 1) + ". " + esc(b.name) + " → <b>" + statsText(b.stats) + "</b> · HP " + b.hp).join("<br>") + "</div>";
    } else {
      const b = boss(), rows = game.results[game.round] || [];
      html += '<div class="secret">' + (game.round === 0 ? "연습 보스" : game.round + "번 보스") + " 판정 스탯 <b>" + statsText(b.stats) + "</b> · 보스 HP " + b.hp + " · 보상 " + b.reward + "점<br>힌트: " + esc(b.hint) + "</div>";
      html += '<table class="res-table"><thead><tr><th>조</th><th>출전자</th><th class="n">판정 합</th><th class="n">룰렛</th><th class="n">공격력</th><th>결과</th></tr></thead><tbody>';
      TEAMS.forEach((name, t) => {
        const k = pickOf(game.round, t), p = k ? people[k.pid] : null, x = rows.find((y) => y.team === t);
        const base = p ? (b.stats || []).reduce((n, s) => n + (charOf(p)[s] || 0), 0) : null;
        html += "<tr><td><b>" + name + "</b></td><td>" + (p ? esc(p.name) + (k.auto ? ' <span class="small">(랜덤)</span>' : k.by != null && people[k.by] ? ' <span class="small">· ' + esc(people[k.by].name) + " 선택</span>" : "") : '<span class="small">선택 전</span>') + "</td>" +
          '<td class="n">' + (base != null ? base : "") + '</td><td class="n">' + (x && x.effect ? esc(effLabel(x.effect)) : "") + '</td><td class="n"><b>' + (x ? x.power : "") + "</b></td><td" + (x && x.cleared ? ' class="ok"' : "") + ">" + (x ? (x.cleared ? "격파" : "실패") + " +" + x.points + (x.mvp ? " MVP" : "") : "") + "</td></tr>";
      });
      html += "</tbody></table>";
      if (game.phase === "meeting" && MODE === "supabase") {
        const dr = STORY_DRAFTS["r" + game.round] || {}, picked = TEAMS.filter((_, t) => pickOf(game.round, t)).length;
        const ready = TEAMS.filter((_, t) => { const k = pickOf(game.round, t); return k && dr[t] && dr[t].pid === k.pid; }).length;
        html += '<div class="small">AI 서술 미리 쓰기: 출전자가 정해진 ' + picked + "개 조 중 " + ready + "개 준비됨" + (draftBusy ? " · 쓰는 중…" : "") + "</div>";
      }
      if (rows.length && rows[0].power != null) {
        html += '<div class="stories"><div class="between"><b>AI 서술</b><button type="button" class="btn quiet sm" data-story' + (storyBusy ? " disabled" : "") + ">" + (storyBusy ? "만드는 중…" : "다시 만들기") + "</button></div>" +
          (storyError ? '<div class="small" style="color:var(--coral-deep)">' + esc(storyError) + "</div>" : "") +
          rows.map((x) => '<div class="story-row"><b>' + TEAMS[x.team] + "</b> " + (x.story ? esc(x.story) : '<span class="small">' + (storyBusy ? "만드는 중…" : "아직 없어요") + "</span>") + "</div>").join("") + "</div>";
      }
    }
    if (game.stage === "boss") html += hostScoreHtml();
    html += '<div class="who-grid">' + personList().map((p) => '<div class="who"><div class="art">' + (p.char ? sprite(p.char) : "") + '</div><div><b><span class="dot' + (p.claimed ? " on" : "") + '"></span>' + esc(p.name) + "</b>" +
      '<span class="small">' + TEAMS[p.team] + " · " + (p.char ? (p.char.isDefault ? "기본 캐릭터" : esc(title(p.char))) : "캐릭터 만드는 중") + "</span></div></div>").join("") + "</div>" +
      '<span class="small">초록 점 = 휴대폰으로 들어온 사람 · ' + personList().length + "명 중 " + personList().filter((p) => p.claimed).length + "명" + (JOIN_MODE === "roster" ? " · 명단 판 (아이디로 입장)" : "") + "</span>" +
      '<button type="button" class="btn quiet sm reset-seats" data-host="resetSeats">' + (JOIN_MODE === "roster" ? "입장 표시 지우기" : "참여자 자리 비우기") + "</button>";
    return html;
  }

  function miniStats(c) {
    return '<div class="mstats">' + STATS.map((s) => "<span>" + s.label + '</span><i><b style="width:' + Math.min(100, (c[s.key] || 0) / RULES.statMax * 100) + "%;background:" + s.color + '"></b></i><span>' + (c[s.key] != null ? c[s.key] : "-") + "</span>").join("") + "</div>";
  }
  function pcard(p, opts) {
    const o = opts || {};
    if (!p.char) return '<div class="pc empty"><div class="art"></div><div><div class="nm">' + esc(p.name) + '</div><div class="muted">캐릭터를 만드는 중</div></div></div>';
    const tag = o.tag ? '<span class="tag">' + esc(o.tag) + "</span>" : "";
    const inner = '<div class="art">' + sprite(p.char) + '</div><div><div class="ttl">' + esc(title(p.char)) + '</div><div class="nm">' + esc(p.name) + tag + "</div>" + miniStats(p.char) + "</div>";
    if (o.button) return '<button type="button" class="pc' + (o.on ? " on" : "") + '" style="--aura:' + auraOf(p.char) + '" ' + o.button + ">" + inner + "</button>";
    return '<div class="pc' + (o.big ? " big" : "") + '" style="--aura:' + auraOf(p.char) + '">' + inner + "</div>";
  }
  const rankHtml = (p) => '<div class="card">' + scoreboard().map((s) => '<div class="rank-row' + (s.team === p.team ? " mine" : "") + '"><b>' + s.rank + "위</b><span>" + TEAMS[s.team] + "</span><span>" + s.total + "점</span></div>").join("") + "</div>";
  function phoneHtml(pid) {
    const p = people[pid];
    if (!game || !p) return '<h3>곧 시작해요</h3><div class="muted">진행자가 게임을 준비하고 있어요.</div>';
    const team = teamOf(p.team);
    if (game.stage === "lobby") return "<h3>곧 시작해요</h3>" + '<div class="card"><div class="t">우리 조 · ' + TEAMS[p.team] + '</div><div class="muted">' + team.map((m) => esc(m.name)).join(", ") + '</div></div><div class="muted">진행자가 시작하면 이 화면이 자동으로 바뀌어요.</div>';
    if ((game.stage === "make" || game.stage === "share") && !game.locked && (!p.char || editing[pid])) {
      const d = drafts[pid] || (drafts[pid] = blankDraft());
      const remain = RULES.statTotal - KEYS.reduce((n, k) => n + d[k], 0);
      return "<h3>나만의 픽셀 캐릭터</h3>" +
        '<div class="card"><div class="remain' + (remain === 0 ? " done" : "") + '">남은 점수 ' + remain + " / " + RULES.statTotal + "</div>" +
        STATS.map((s) => '<div class="stepper"><span style="color:' + s.color + '">' + s.label + '</span><button type="button" data-p="' + pid + '" data-a="dec" data-k="' + s.key + '" aria-label="' + s.label + ' 1점 빼기"' + (d[s.key] <= RULES.statMin ? " disabled" : "") + '>−</button><div class="bar"><b style="width:' + Math.min(100, d[s.key] / RULES.statMax * 100) + "%;background:" + s.color + '"></b></div><span>' + d[s.key] + '</span><button type="button" data-p="' + pid + '" data-a="inc" data-k="' + s.key + '" aria-label="' + s.label + ' 1점 더하기"' + (d[s.key] >= RULES.statMax || remain <= 0 ? " disabled" : "") + ">+</button></div>").join("") +
        '<div class="muted">스탯 하나는 ' + RULES.statMin + "~" + RULES.statMax + "점, 합계 " + RULES.statTotal + "점. 외형은 스탯에 따라 자동으로 정해져요." + (RULES.luckPower > 0 ? " <b>운</b>이 높을수록 돌발 이벤트 룰렛에서 좋은 칸이 잘 나와요." : "") + "</div></div>" +
        '<div class="card"><div class="t">미리보기</div>' + pcard({ name: p.name, char: Object.assign({ seed: p.seed }, d) }, { big: true }) + "</div>" +
        '<button type="button" class="pbtn" data-p="' + pid + '" data-a="save"' + (remain !== 0 ? " disabled" : "") + ">" + (remain !== 0 ? "점수를 " + remain + "점 더 나눠 주세요" : p.char ? "이대로 저장" : "캐릭터 생성") + "</button>" +
        '<button type="button" class="pbtn ghost" data-p="' + pid + '" data-a="randomDraft">랜덤으로 나눠 보기</button>' +
        (p.char ? '<button type="button" class="pbtn ghost" data-p="' + pid + '" data-a="cancel">고치지 않고 돌아가기</button>' : "");
    }
    if (game.stage === "make" || game.stage === "share") {
      let h = "<h3>나의 캐릭터</h3>" + pcard(p, { big: true });
      if (!game.locked) h += '<div class="row"><button type="button" class="pbtn ghost" data-p="' + pid + '" data-a="reroll"' + (p.rerolls >= RULES.rerolls ? " disabled" : "") + ">외형 랜덤 뽑기 (" + Math.max(0, RULES.rerolls - p.rerolls) + ")</button>" +
        '<button type="button" class="pbtn ghost" data-p="' + pid + '" data-a="edit">스탯 고치기</button></div>';
      if (game.stage === "share") h += '<div class="card"><div class="t t-row">조원에게 소개해 주세요 <span class="ptimer inline" data-deadline="' + game.shareDeadline + '"></span></div><div class="muted">1) 내 칭호, 맞는지 아닌지<br>2) 가장 높은 스탯의 에피소드<br>3) 가장 낮은 스탯의 고백</div></div>';
      h += '<div class="card"><div class="t">우리 조 캐릭터</div>' + team.filter((m) => m.id !== pid).map((m) => pcard(m)).join("") + "</div>";
      return h;
    }
    if (game.phase === "idle") return "<h3>보스 레이드가<br>곧 시작돼요</h3>" + '<div class="card"><div class="muted">먼저 연습 보스와 한 판 (점수 없음)<br>보스 ' + BOSSES.length + '판 · 라운드마다 조에서 1명 출전<br>한 사람은 최대 ' + capOf(p.team) + '번까지<br>판정 스탯은 비공개, 보스 설명을 보고 조원과 추리<br>판정 스탯 합이 보스 HP 이상이면 격파</div></div>' + team.map((m) => pcard(m, { tag: m.id === pid ? "나" : "" })).join("");
    const b = boss();
    let h = '<div class="card"><div class="boss-mini">' + bossSprite(game.round) + '<div><div class="muted">' + rlabel() + '</div><div class="t">' + esc(b.name) + '</div></div></div>' + fold("d" + game.round, b.desc) +
      '<div class="phone-chips"><span class="hpc">HP ' + b.hp + "</span>" + (game.round === 0 ? "<span>연습</span>" : "<span>보상 " + b.reward + "점</span>") + (b.nStats > 2 ? "<span>판정 스탯 " + b.nStats + "개</span>" : "") + "</div>" +
      (game.hint && game.phase === "meeting" ? '<div class="muted"><b>힌트</b> ' + esc(b.hint) + "</div>" : "") +
      (game.phase === "meeting" ? '<div class="ptimer" data-deadline="' + game.deadline + '"></div>' : "") + "</div>";
    const k = pickOf(game.round, p.team), pick = k ? people[k.pid] : null;
    if (game.phase === "meeting") {
      return h + '<div class="card"><div class="t">출전자 고르기</div><div class="muted">' + (pick ? "<b>" + esc(pick.name) + "</b> 님이 출전해요" + (k.by != null && people[k.by] ? " · " + esc(people[k.by].name) + " 님이 골랐어요" : "") : "아직 출전자가 없어요. 조원 누구나 고를 수 있어요.") + "</div>" +
        team.map((m) => {
          const ok = canPick(m.id, p.team);
          const n = plays(m.id, game.round);
          const tag = !present(m) ? "미입장" : pick && pick.id === m.id ? "출전" : !ok ? n + "번 다 나감" : m.id === pid ? "나" : n ? n + "번 나감" : "";
          return pcard(m, { tag, on: pick && pick.id === m.id, button: 'data-p="' + pid + '" data-a="pick" data-m="' + m.id + '"' + (ok ? "" : " disabled") });
        }).join("") + '<div class="muted">마감 전까지는 조원 누구나 바꿀 수 있고, 마감 때 고른 사람이 최종이에요. 만약 회의 시간이 끝나도 정해지지 않았다면, 랜덤으로 지정돼요.</div></div>';
    }
    const x = (game.results[game.round] || []).find((y) => y.team === p.team);
    if (game.phase === "closed") return h + '<div class="card"><div class="t">' + (x ? esc(x.name) + " 님 출전!" : "마감") + '</div><div class="muted">' + (x && x.auto ? "아무도 안 골라서 랜덤으로 정해졌어요. " : "") + "앞쪽 화면에서 결과 공개를 기다려 주세요." + "</div></div>";
    // 우리 조 룰렛만
    if (game.phase === "rolled" && x) {
      return h + '<div class="card pdice"><div class="t ev-alert">!! 돌발 이벤트 발생 !!</div><div class="t">' + TEAMS[p.team] + " 룰렛</div><div class=\"muted\">" + esc(x.name) + " 님 차례예요</div>" + reel(x) +
        '<div class="muted">룰렛 칸: ' + esc(spinRules()) + "</div></div>";
    }
    if (game.phase === "revealed" && x) {
      const f = people[x.pid];
      return h + '<div class="card"><div class="outcome' + (x.cleared ? " win" : "") + '">' + (x.cleared ? "격파!" : "아쉽게 실패") + "</div>" +
        '<div class="pfight' + (x.cleared ? " win" : " lose") + '"><div class="art">' + (f ? sprite(charOf(f)) : "") + '</div><div class="pvs"><b class="pdmg">' + x.power + '</b><span>공격력</span></div><div class="pboss">' + bossSprite(game.round) + (x.cleared ? '<b class="ko-stamp">K.O.</b>' : "") + "</div></div>" +
        '<div class="php"><i style="--left:' + Math.max(0, (b.hp - x.power) / b.hp * 100) + '%"></i></div>' +
        '<div class="php-t">' + (x.cleared ? "보스 HP " + b.hp + " → 0 · 격파!" : "보스 HP " + b.hp + " → " + (b.hp - x.power) + " 남음 · " + (b.hp - x.power) + "점만 더 있었으면!") + "</div>" +
        '<div class="muted"><b>' + esc(x.name) + "</b> 님 공격력 <b>" + x.power + "</b> / 보스 HP " + b.hp + "</div>" +
        '<div class="muted">판정 스탯 <b>' + esc(statLine(x, b)) + " = " + x.base + "</b>" + (x.effect ? " · " + esc(diceText(x)) : "") + "</div>" +
        (game.round === 0 ? '<div class="t">연습 라운드 · 점수 없음</div>' : '<div class="t">+' + x.points + "점" + (x.mvp ? " · MVP" : "") + "</div>") + storyBox(x) + '<div class="muted"><b>' + esc(myResultLine(x, b)) + "</b></div></div>" +
        (game.round && game.view === 2 ? "<h3>중간 집계 · " + game.round + "라운드까지</h3>" + rankHtml(p) : '<div class="muted">누적 점수와 순위는 중간 집계와 마지막에 공개돼요.</div>');
    }
    return "<h3>최종 순위</h3>" + rankHtml(p);
  }

  // 휴대폰의 긴 글: 처음엔 두 줄만, "더 보기"로 펼침
  const moreOpen = new Set();
  function fold(key, text) {
    const t = esc(text);
    const open = moreOpen.has(key);
    // "더 보기"는 그린 뒤 실제로 두 줄을 넘칠 때만 보입니다 (measureFolds)
    return '<div class="fold' + (open ? " open" : "") + '"><div class="muted ftxt">' + t + '</div><button type="button" class="more" data-more="' + key + '" hidden>' + (open ? "접기" : "더 보기") + "</button></div>";
  }

  let infoOpen = false;
  // i 창(점수 규칙): 설정 탭에서 고친 문구가 있으면 그것, 없으면 기본 문구. {보상} {룰렛} {MVP} 는 지금 설정 값으로 바뀝니다.
  const DEFAULT_INFO_TITLE = "점수는 이렇게 매겨요";
  const defaultInfoSections = () => [
    { title: "공격력", body: "출전자의 **판정 스탯 합**이 공격력이에요. 어떤 스탯이 판정되는지는 비공개이고, 결과 공개 때 알려 줘요. 돌발 이벤트가 터지면 여기에 룰렛 결과가 더해져요." },
    { title: "격파 / 실패", body: "공격력이 **보스 HP 이상이면 격파** → 그 보스의 보상 점수를 받아요. 모자라면 **실패 → 0점**.\n{보상}" },
    { title: "MVP", body: "라운드마다 공격력이 가장 높은 조가 **{MVP}점**을 더 받아요. 격파하지 못해도 받을 수 있고, 동점이면 모두 받아요." },
    { title: "돌발 이벤트 룰렛", body: "룰렛에 걸린 칸의 효과를 받아요.\n{룰렛}" },
    { title: "순위", body: "라운드 점수(격파 보상 + MVP + 룰렛 점수)를 모두 더한 **총점** 순이에요. 총점이 같으면 **격파 횟수**가 많은 조가 위이고, 격파 횟수까지 같으면 같은 등수예요. 몇 라운드마다 **중간 집계**를 보여 주고, 최종 순위는 **마지막에 공개**돼요." },
    { title: "출전", body: "연습 라운드는 점수와 출전 기록에 들어가지 않아요. 라운드마다 조에서 **1명**이 나가요. 한 사람은 **최대 2번**까지 나갈 수 있고(조원이 6명 미만인 조는 **3번**), 입장한 사람만 고를 수 있어요. 회의 시간이 끝날 때까지 아무도 안 고르면 덜 나간 사람 중에서 랜덤으로 정해져요." },
  ];
  const fillInfo = (t) => String(t || "")
    .replace(/\{보상\}/g, BOSSES.map((b, i) => i + 1 + "번 " + b.reward + "점").join(" · "))
    .replace(/\{룰렛\}/g, (RULES.roulette || []).map(effLabel).join("\n"))
    .replace(/\{MVP\}/g, sign(RULES.mvpBonus));
  function infoHtml() {
    const secs = RULES.infoSections && RULES.infoSections.length ? RULES.infoSections : defaultInfoSections();
    return '<div class="modal-back" data-info-close><div class="modal" role="dialog" aria-modal="true" aria-label="점수 규칙"><div class="modal-head"><h3>' + esc(RULES.infoTitle || DEFAULT_INFO_TITLE) + '</h3><button type="button" class="info-btn x" data-info-close aria-label="닫기">✕</button></div>' +
      secs.map((x) => '<div class="card"><div class="t">' + esc(x.title) + '</div><div class="muted">' + richText(fillInfo(x.body)) + "</div></div>").join("") + "</div></div>";
  }
  // 설정 칸 글 ↔ 칸 목록: "## 제목" 줄로 칸을 나눔
  const infoToText = (secs) => secs.map((x) => "## " + x.title + "\n" + x.body).join("\n\n");
  function textToInfo(text) {
    const out = [];
    String(text || "").split(/\r?\n/).forEach((line) => {
      const m = line.match(/^##\s*(.*)$/);
      if (m) out.push({ title: m[1].trim(), body: [] });
      else if (out.length) out[out.length - 1].body.push(line);
    });
    return out.map((x) => ({ title: x.title, body: x.body.join("\n").trim() })).filter((x) => x.title || x.body);
  }
  const infoBtn = '<button type="button" class="info-btn" data-info aria-label="점수 규칙 보기">i</button>';
  // ── 보스·규칙 설정 탭 (진행자만) ─────────────────────────────────
  // 고치는 동안에는 이 화면의 setDraft 에만 두고, "저장"을 눌러야 Supabase(또는 이 브라우저의 엔진)에 들어갑니다.
  let setDraft = null;
  let setBusy = false;
  const CFG_FIELDS = [
    { k: "statTotal", label: "스탯 합계", unit: "점", note: "캐릭터가 스탯 5개에 나눠 쓰는 점수", rule: true },
    { k: "statMin", label: "스탯 최소", unit: "점", rule: true },
    { k: "statMax", label: "스탯 최대", unit: "점", rule: true },
    { k: "rerolls", label: "외형 랜덤 뽑기", unit: "번", note: "캐릭터 만들 때 외형(머리·피부·액세서리)을 랜덤으로 다시 뽑을 수 있는 횟수" },
    { k: "shareMin", label: "조 내 공유 시간", unit: "분" },
    { k: "meetingSec", label: "보스 회의 시간", unit: "초" },
    { k: "practiceMeetingSec", label: "연습 보스 회의 시간", unit: "초", note: "연습 라운드에만 쓰는 회의 시간" },
    { k: "mvpBonus", label: "MVP 점수", unit: "점", note: "라운드 공격력 1위 조가 받는 점수" },
    { k: "luckPower", label: "운 효과 세기", unit: "", note: "운이 높을수록 룰렛의 아래쪽 칸이 잘 나오는 정도 (0~100). 0이면 운과 상관없이 모든 칸이 같은 확률" },
  ];
  const BOSS_KEYS = ["name", "desc", "hp", "reward", "event", "diceLow", "diceHigh", "stats", "hint", "reveal"];
  const bossOut = (b) => Object.fromEntries(BOSS_KEYS.map((k) => [k, k === "stats" ? (b.stats || []).slice() : k === "event" ? !!b.event : b[k] == null ? (k === "diceLow" ? -2 : k === "diceHigh" ? 3 : "") : b[k]]));
  function makeDraft() {
    return { dirty: false,
      config: Object.fromEntries(CFG_FIELDS.map((f) => [f.k, String(RULES[f.k])])),
      bosses: poolDraft(),
      roulette: (RULES.roulette || []).map((x) => ({ kind: x.kind, value: String(x.value) })),
      texts: { joinShort: RULES.joinShort || "", lobbyTitle: RULES.lobbyTitle || "", lobbySub: RULES.lobbySub || "", rulesTitle: RULES.rulesTitle || "", rulesLines: (RULES.rulesLines || []).join("\n"),
        infoTitle: RULES.infoTitle || "", infoText: infoToText(RULES.infoSections || []) },
      practice: (() => { const p = RULES.practiceBoss || {}; return { name: p.name || "", desc: p.desc || "", hp: String(p.hp == null ? 10 : p.hp), stats: (p.stats || []).slice(), hint: p.hint || "", reveal: p.reveal || "" }; })() };
  }
  // 보스 목록 초안: 지금 출전 보스가 순서대로 위에(on), 그 아래 보스 목록의 나머지(off). 같은 이름이면 출전 보스 쪽 내용
  const POOL_MAX = 30, LINEUP_MAX = 20;
  const openBoss = new Set();   // 편집 칸을 연 보스 이름 (화면을 다시 그려도 유지)
  function poolDraft() {
    const str = (b, on) => { const o = bossOut(b); ["hp", "reward", "diceLow", "diceHigh"].forEach((k) => { o[k] = String(o[k]); }); return Object.assign(o, { on, open: openBoss.has(String(b.name).trim()) }); };
    const list = BOSSES.map((b) => str(b, true)), names = new Set(list.map((b) => String(b.name).trim()));
    (RULES.bossPool || []).forEach((b) => { const n = String(b.name || "").trim(); if (n && !names.has(n)) { names.add(n); list.push(str(b, false)); } });
    return list;
  }
  const newBoss = () => ({ on: true, open: true, name: "새 보스", desc: "", hp: "12", reward: "2", event: false, diceLow: "-2", diceHigh: "3", stats: ["hp", "mental"], hint: "", reveal: "" });
  const toInt = (v) => (/^\s*-?\d+\s*$/.test(String(v)) ? Number(String(v).trim()) : NaN);
  const roundBusy = () => !!game && (game.phase === "meeting" || game.phase === "closed" || game.phase === "rolled");
  const canSettings = () => MODE === "local" || (MODE === "supabase" && isHost);

  function settingsHtml() {
    if (!setDraft || !setDraft.dirty) setDraft = makeDraft();
    const d = setDraft, avg = toInt(d.config.statTotal) / KEYS.length;
    const ruleLocked = !!game && game.stage !== "lobby";
    let h = '<main class="wrap settings">';
    if (roundBusy()) h += '<div class="notice">지금 ' + game.round + "라운드가 진행 중이에요. 보스는 결과 공개 뒤에 저장할 수 있어요. 규칙(시간·MVP·운)은 지금도 저장돼요.</div>";
    h += '<section class="panel"><h2>참여자 명단</h2><p class="small">관리 화면 <b>명단 · 조</b> 탭의 명단을 그대로 써요(조 이름에 Chief·치프가 들어간 조는 빠져요). ' +
      "캐릭터 만들기를 시작할 때 최신 명단으로 다시 맞추고, 참여자는 워크샵에 입장한 Knox ID로 자동으로 들어와요." +
      (game && personList().length ? " 지금 " + personList().length + "명 · 조 " + TEAM_NAMES.length + "개." : "") + "</p></section>";
    h += '<section class="panel"><h2>게임 규칙</h2><div class="cfg-grid">' + CFG_FIELDS.map((f) =>
      '<label class="f"><span>' + f.label + '</span><span class="num"><input type="number" inputmode="numeric" step="1" data-f="c.' + f.k + '" value="' + esc(d.config[f.k]) + '"' + (f.rule && ruleLocked ? " disabled" : "") + "><em>" + f.unit + "</em></span>" +
      (f.note ? "<small>" + esc(f.note) + "</small>" : "") + "</label>").join("") + "</div>" +
      '<p class="small">스탯 규칙(합계·최소·최대)은 대기 단계에서만 바꿀 수 있어요' + (ruleLocked ? '. 지금은 잠겨 있어요. 보스 레이드 탭에서 "처음부터"를 누르면 바꿀 수 있어요.' : ".") + " 시간은 다음에 시작하는 단계부터 적용돼요.</p></section>";
    const T = d.texts, tf = (k) => 'data-f="t.' + k + '"';
    h += '<section class="panel"><h2>첫 화면 · 규칙 화면 문구</h2><p class="small">발표 화면의 첫 화면(대기·QR·참여 주소)과 보스 레이드 규칙 화면에 나오는 글이에요. <b>비워 두면 기본 문구</b>가 나와요. **이렇게** 감싸면 굵게, 줄바꿈은 그대로 보여요.</p>' +
      '<label class="f"><span>짧은 참여 주소 (발표 화면에 크게 보여요)</span><input type="text" maxlength="100" ' + tf("joinShort") + ' placeholder="' + esc(JOIN_URL.replace(/^https?:\/\//, "").replace(/\/$/, "")) + '" value="' + esc(T.joinShort) + '">' +
      "<small>bit.ly · is.gd 같은 단축 주소를 만들어 적어 두면, QR 옆에 참여자가 보고 칠 수 있게 크게 보여요. 비워 두면 실제 주소가 보여요. QR은 언제나 실제 주소예요.</small></label>" +
      '<label class="f"><span>첫 화면 제목</span><textarea rows="2" maxlength="200" ' + tf("lobbyTitle") + ' placeholder="나만의 픽셀 캐릭터&#10;&amp; 보스 레이드">' + esc(T.lobbyTitle) + "</textarea></label>" +
      '<label class="f"><span>첫 화면 안내</span><input type="text" maxlength="200" ' + tf("lobbySub") + ' placeholder="휴대폰으로 QR을 찍거나 아래 주소를 입력하고, Knox ID로 입장해 주세요" value="' + esc(T.lobbySub) + '"></label>' +
      '<label class="f"><span>규칙 화면 제목</span><input type="text" maxlength="200" ' + tf("rulesTitle") + ' placeholder="' + esc(defaultRulesTitle()) + '" value="' + esc(T.rulesTitle) + '"></label>' +
      '<label class="f"><span>규칙 (한 줄에 한 항목, 12줄까지)</span><textarea rows="8" ' + tf("rulesLines") + ' placeholder="' + esc(defaultRuleLines().join("\n")) + '">' + esc(T.rulesLines) + "</textarea></label>" +
      '<div class="row left"><button type="button" class="btn sm" data-set="rulesFill">기본 규칙 문구를 불러와서 고치기</button></div></section>';
    h += '<section class="panel"><h2>i 창 (점수 규칙) 문구</h2><p class="small">휴대폰 위쪽 <b>i</b> 버튼을 누르면 나오는 창이에요. <b>비워 두면 기본 문구</b>가 나와요. ' +
      "<b>## 제목</b> 줄로 칸을 나누고 그 아래에 내용을 써요(12칸까지). **굵게**, 줄바꿈 그대로. " +
      "<b>{보상}</b>은 보스별 보상 점수, <b>{룰렛}</b>은 룰렛 칸 목록, <b>{MVP}</b>는 MVP 점수로 바뀌어요.</p>" +
      '<label class="f"><span>창 제목</span><input type="text" maxlength="60" ' + tf("infoTitle") + ' placeholder="' + esc(DEFAULT_INFO_TITLE) + '" value="' + esc(T.infoTitle) + '"></label>' +
      '<label class="f"><span>내용</span><textarea rows="12" ' + tf("infoText") + ' placeholder="' + esc(infoToText(defaultInfoSections())) + '">' + esc(T.infoText) + "</textarea></label>" +
      '<div class="row left"><button type="button" class="btn sm" data-set="infoFill">기본 i 창 문구를 불러와서 고치기</button></div></section>';
    const P = d.practice, pf = (k) => 'data-f="p.' + k + '"';
    h += '<section class="panel"><h2>연습 보스</h2><p class="small">규칙 설명 다음에 진행자가 "연습 보스 시작"을 누르면 한 판 연습해요. 룰렛은 항상 터지고, 점수와 출전 기록에는 들어가지 않아요.</p><div class="bcard">' +
      '<label class="f"><span>이름</span><input type="text" maxlength="60" ' + pf("name") + ' value="' + esc(P.name) + '"></label>' +
      '<label class="f"><span>설명 (모두에게 보임)</span><textarea rows="2" maxlength="300" ' + pf("desc") + ">" + esc(P.desc) + "</textarea></label>" +
      '<div class="f-row"><label class="f"><span>보스 HP</span><input type="number" inputmode="numeric" step="1" ' + pf("hp") + ' value="' + esc(P.hp) + '"></label></div>' +
      '<div class="f"><span>판정 스탯 (공격력 = 고른 스탯의 합)</span><div class="checks">' + STATS.map((st) =>
        '<label class="chk"><input type="checkbox" ' + pf("stat." + st.key) + (P.stats.includes(st.key) ? " checked" : "") + '><span style="color:' + st.color + '">' + st.label + "</span></label>").join("") + "</div></div>" +
      '<label class="f"><span>힌트 (진행자가 "힌트 공개"를 누르면 보임)</span><input type="text" maxlength="200" ' + pf("hint") + ' value="' + esc(P.hint) + '"></label>' +
      '<label class="f"><span>결과 공개 때 설명</span><textarea rows="2" maxlength="300" ' + pf("reveal") + ">" + esc(P.reveal) + "</textarea></label></div></section>";
    h += '<section class="panel"><h2>돌발 이벤트 룰렛</h2><p class="small">돌발 이벤트가 켜진 보스와 연습 보스는 마감 뒤 이 룰렛을 돌려요(모든 보스 공통). 칸 문구는 효과대로 자동으로 만들어져요. ' +
      "운이 높을수록 <b>아래쪽 칸</b>이 잘 나오니 좋은 효과를 아래에 두세요. 칸은 2~10개예요.</p>" +
      d.roulette.map((x, i) => '<div class="spin-row"><b>' + (i + 1) + '</b><select data-f="s.' + i + '.kind" aria-label="' + (i + 1) + '번 칸 효과">' +
        SPIN_KINDS.map(([k, l]) => '<option value="' + k + '"' + (x.kind === k ? " selected" : "") + ">" + l + "</option>").join("") + "</select>" +
        (x.kind === "none" ? "<span></span>" : '<input type="number" inputmode="numeric" step="1" data-f="s.' + i + '.value" value="' + esc(x.value) + '" aria-label="' + (i + 1) + '번 칸 값">') +
        '<span class="spin-label">→ ' + esc(effLabel({ kind: x.kind, value: toInt(x.value) || 0 })) + "</span>" +
        '<span class="bact"><button type="button" class="btn sm" data-set="sup:' + i + '"' + (i === 0 ? " disabled" : "") + ' aria-label="' + (i + 1) + '번 칸 위로">↑</button>' +
        '<button type="button" class="btn sm" data-set="sdown:' + i + '"' + (i === d.roulette.length - 1 ? " disabled" : "") + ' aria-label="' + (i + 1) + '번 칸 아래로">↓</button>' +
        '<button type="button" class="btn sm" data-set="sdel:' + i + '"' + (d.roulette.length <= 2 ? " disabled" : "") + ">삭제</button></span></div>").join("") +
      '<button type="button" class="btn" data-set="sadd"' + (d.roulette.length >= 10 ? " disabled" : "") + ' style="align-self:flex-start">+ 칸 추가</button></section>';
    const minCount = game && game.stage === "boss" ? Math.max(1, game.round || 0) : 1;
    const nOn = d.bosses.filter((b) => b.on).length;
    h += '<section class="panel"><div class="bcount"><h2>보스</h2><span class="bnum">출전 ' + nOn + "명 · 목록 " + d.bosses.length + "명</span></div>" +
      '<p class="small"><b>출전</b>에 체크한 보스만 위에서부터 순서대로 1라운드, 2라운드…로 나와요(1~' + LINEUP_MAX + "명). 체크를 빼도 목록에 남아 있어서 다음에 다시 고를 수 있어요(목록은 " + POOL_MAX + "명까지). " +
      "↑↓로 순서를 바꾸고, <b>편집</b>을 눌러 내용을 고쳐요. 저장해야 반영돼요." + (minCount > 1 ? " 이미 진행한 " + game.round + "라운드보다 출전 보스를 줄일 수 없어요." : "") + "</p>" +
      '<p class="small">판정 스탯·힌트·결과 설명은 결과 공개 전까지 참여자에게 보이지 않아요. "평균 공격력"은 모든 스탯이 평균(' + (isFinite(avg) ? Math.round(avg * 10) / 10 : "?") + "점)인 캐릭터가 이 보스에서 내는 공격력이에요.</p>";
    let round = 0;
    d.bosses.forEach((b, i) => {
      if (b.on) round++;
      const hp = toInt(b.hp), exp = isFinite(avg) ? Math.round(b.stats.length * avg * 10) / 10 : NaN;
      const level = isFinite(exp) && isFinite(hp) ? (exp >= hp ? " · 쉬움" : exp + 3 >= hp ? " · 보통" : " · 어려움") : "";
      const f = (k) => 'data-f="b.' + i + "." + k + '"';
      const num = (k, label) => '<label class="f"><span>' + label + '</span><input type="number" inputmode="numeric" step="1" ' + f(k) + ' value="' + esc(b[k]) + '"></label>';
      const statTxt = STATS.filter((s) => b.stats.includes(s.key)).map((s) => '<span style="color:' + s.color + '">' + s.label + "</span>").join(" + ") || "판정 스탯 없음";
      h += '<div class="bcard pool' + (b.on ? "" : " off") + '"><div class="bcard-h">' +
        '<label class="chk"><input type="checkbox" ' + f("on") + (b.on ? " checked" : "") + ' aria-label="' + esc(b.name) + ' 출전"><span class="bround">' + (b.on ? round + "라운드" : "대기") + "</span></label>" +
        '<b class="bname">' + esc(b.name || "(이름 없음)") + "</b>" +
        '<span class="bact"><button type="button" class="btn sm" data-set="up:' + i + '"' + (i === 0 ? " disabled" : "") + ' aria-label="' + esc(b.name) + ' 위로">↑</button>' +
        '<button type="button" class="btn sm" data-set="down:' + i + '"' + (i === d.bosses.length - 1 ? " disabled" : "") + ' aria-label="' + esc(b.name) + ' 아래로">↓</button>' +
        '<button type="button" class="btn sm" data-set="open:' + i + '" aria-expanded="' + !!b.open + '">' + (b.open ? "접기" : "편집") + "</button>" +
        '<button type="button" class="btn sm" data-set="del:' + i + '"' + (d.bosses.length <= 1 ? " disabled" : "") + ">삭제</button></span>" +
        '<span class="bexp">' + statTxt + " · 평균 공격력 " + (isFinite(exp) ? exp : "?") + " / HP " + (isFinite(hp) ? hp : "?") + level + " · 보상 " + esc(b.reward) + "점" + (b.event ? " · 룰렛" : "") + "</span></div>";
      if (b.open) h +=
        '<label class="f"><span>이름</span><input type="text" maxlength="60" ' + f("name") + ' value="' + esc(b.name) + '"></label>' +
        '<label class="f"><span>설명 (모두에게 보임)</span><textarea rows="3" maxlength="300" ' + f("desc") + ">" + esc(b.desc) + "</textarea></label>" +
        '<div class="f-row">' + num("hp", "보스 HP") + num("reward", "격파 보상 점수") + "</div>" +
        '<div class="f"><span>판정 스탯 (공격력 = 고른 스탯의 합)</span><div class="checks">' + STATS.map((s) =>
          '<label class="chk"><input type="checkbox" ' + f("stat." + s.key) + (b.stats.includes(s.key) ? " checked" : "") + '><span style="color:' + s.color + '">' + s.label + "</span></label>").join("") + "</div></div>" +
        '<div class="f"><label class="chk"><input type="checkbox" ' + f("event") + (b.event ? " checked" : "") + "><span>돌발 이벤트 (룰렛)</span></label>" +
        (b.event ? "<small>마감 뒤 결과 공개 전에 룰렛이 터져요. 룰렛 칸은 위의 '돌발 이벤트 룰렛'에서 정해요.</small>" : "") + "</div>" +
        '<label class="f"><span>힌트 (진행자가 "힌트 공개"를 누르면 보임)</span><input type="text" maxlength="200" ' + f("hint") + ' value="' + esc(b.hint) + '"></label>' +
        '<label class="f"><span>결과 공개 때 설명</span><textarea rows="3" maxlength="300" ' + f("reveal") + ">" + esc(b.reveal) + "</textarea></label>";
      h += "</div>";
    });
    h += '<button type="button" class="btn" data-set="add"' + (d.bosses.length >= POOL_MAX ? " disabled" : "") + ' style="align-self:flex-start">+ 새 보스 만들기</button></section>';
    h += '<div class="save-bar"><span class="small" data-dirty>' + (d.dirty ? "저장하지 않은 변경이 있어요" : "저장된 내용과 같아요") + "</span>" +
      '<button type="button" class="btn quiet" data-set="defaults">보스 기본값으로</button><button type="button" class="btn" data-set="revert">변경 취소</button>' +
      '<button type="button" class="btn go" data-set="save">저장</button></div></main>';
    return h;
  }
  // 입력 칸 → setDraft (화면을 다시 그리지 않음, 체크박스만 다시 그림)
  function setField(el) {
    const path = (el.dataset.f || "").split("."), d = setDraft;
    if (!d || !path[0]) return false;
    if (path[0] === "c") d.config[path[1]] = el.value;
    else if (path[0] === "t") d.texts[path[1]] = el.value;
    else if (path[0] === "s") { const x = d.roulette[Number(path[1])]; if (!x) return false; x[path[2]] = el.value; }
    else if (path[0] === "p") {
      if (path[1] === "stat") d.practice.stats = KEYS.filter((k) => (k === path[2] ? el.checked : d.practice.stats.includes(k)));
      else d.practice[path[1]] = el.value;
    } else {
      const b = d.bosses[Number(path[1])];
      if (!b) return false;
      if (path[2] === "stat") b.stats = KEYS.filter((k) => (k === path[3] ? el.checked : b.stats.includes(k)));
      else if (path[2] === "event") b.event = el.checked;
      else if (path[2] === "on") b.on = el.checked;
      else b[path[2]] = el.value;
    }
    d.dirty = true;
    return true;
  }
  function onInput(e, mt) {
    const el = e.target;
    if (!el.dataset || !el.dataset.f || el.type === "checkbox") return;
    if (setField(el)) {
      const m = mt.root.querySelector("[data-dirty]"); if (m) m.textContent = "저장하지 않은 변경이 있어요";
      const row = el.closest(".spin-row"), lab = row && row.querySelector(".spin-label");
      if (el.dataset.f.endsWith(".name")) { const c = el.closest(".bcard"), t = c && c.querySelector(".bname"); if (t) t.textContent = el.value || "(이름 없음)"; }
      if (lab && setDraft) { const x = setDraft.roulette[Number(el.dataset.f.split(".")[1])]; if (x) lab.textContent = "→ " + effLabel({ kind: x.kind, value: toInt(x.value) || 0 }); }
    }
  }
  function onChange(e) {
    const el = e.target;
    if (el.dataset && el.dataset.f && (el.type === "checkbox" || el.tagName === "SELECT") && setField(el)) { invalidate(); }
  }
  async function saveSettings() {
    const d = setDraft;
    if (!d) return;
    const cfg = {};
    for (const f of CFG_FIELDS) {
      cfg[f.k] = toInt(d.config[f.k]);
      if (!Number.isInteger(cfg[f.k])) { toast(f.label + "에 정수를 적어 주세요"); return; }
    }
    const pool = [], bosses = [], seen = new Set();
    for (let i = 0; i < d.bosses.length; i++) {
      const b = d.bosses[i], o = bossOut(b), who = "'" + (String(b.name).trim() || i + 1 + "번째 보스") + "': ";
      ["name", "desc", "hint", "reveal"].forEach((k) => { o[k] = String(o[k]).trim(); });
      if (!o.name) { toast(i + 1 + "번째 보스: 이름을 적어 주세요"); return; }
      if (seen.has(o.name)) { toast("보스 이름 '" + o.name + "'가 두 번 있어요. 이름을 다르게 해 주세요"); return; }
      seen.add(o.name);
      for (const k of ["hp", "reward", "diceLow", "diceHigh"]) {
        o[k] = toInt(b[k]);
        if (!Number.isInteger(o[k])) { toast(who + "숫자 칸에 정수를 적어 주세요"); return; }
      }
      if (!o.stats.length) { toast(who + "판정 스탯을 1개 이상 골라 주세요"); return; }
      pool.push(o);
      if (b.on) bosses.push(o);
    }
    const minCount = game && game.stage === "boss" ? Math.max(1, game.round || 0) : 1;
    if (!bosses.length) { toast("출전할 보스를 1명 이상 체크해 주세요"); return; }
    if (bosses.length > LINEUP_MAX) { toast("출전 보스는 " + LINEUP_MAX + "명까지예요 (지금 " + bosses.length + "명)"); return; }
    if (bosses.length < minCount) { toast("이미 진행한 " + game.round + "라운드보다 출전 보스를 줄일 수 없어요"); return; }
    if (pool.length > POOL_MAX) { toast("보스 목록은 " + POOL_MAX + "명까지예요"); return; }
    cfg.bossPool = pool;
    cfg.roulette = [];
    for (let i = 0; i < d.roulette.length; i++) {
      const x = d.roulette[i], v = x.kind === "none" ? 0 : toInt(x.value);
      if (!Number.isInteger(v)) { toast("룰렛 " + (i + 1) + "번 칸: 정수를 적어 주세요"); return; }
      cfg.roulette.push({ kind: x.kind, value: v });
    }
    const P = d.practice, php = toInt(P.hp);
    if (!Number.isInteger(php)) { toast("연습 보스: HP에 정수를 적어 주세요"); return; }
    if (!P.stats.length) { toast("연습 보스: 판정 스탯을 1개 이상 골라 주세요"); return; }
    cfg.practiceBoss = { name: String(P.name).trim(), desc: String(P.desc).trim(), hp: php, stats: P.stats.slice(), hint: String(P.hint).trim(), reveal: String(P.reveal).trim() };
    const T = d.texts, lines = String(T.rulesLines).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    if (lines.length > 12) { toast("규칙은 12줄까지예요"); return; }
    if (lines.some((x) => x.length > 200)) { toast("규칙 한 줄은 200자까지예요"); return; }
    const info = textToInfo(T.infoText);
    if (info.length > 12) { toast("i 창은 12칸까지예요"); return; }
    if (info.some((x) => !x.title || x.title.length > 40 || x.body.length > 800)) { toast("i 창: 칸마다 '## 제목'(40자까지)이 있어야 하고, 내용은 800자까지예요"); return; }
    const short = String(T.joinShort).trim();
    if (short.length > 100 || /\s/.test(short)) { toast("짧은 참여 주소는 띄어쓰기 없이 100자까지예요"); return; }
    Object.assign(cfg, { joinShort: short, lobbyTitle: String(T.lobbyTitle).trim(), lobbySub: String(T.lobbySub).trim(), rulesTitle: String(T.rulesTitle).trim(), rulesLines: lines,
      infoTitle: String(T.infoTitle).trim(), infoSections: info });
    const textChanged = ["joinShort", "lobbyTitle", "lobbySub", "rulesTitle", "infoTitle"].some((k) => cfg[k] !== (RULES[k] || "")) || JSON.stringify(lines) !== JSON.stringify(RULES.rulesLines || []) ||
      JSON.stringify(info) !== JSON.stringify(RULES.infoSections || []);
    const rp = RULES.practiceBoss || {};
    const cfgChanged = textChanged || CFG_FIELDS.some((f) => cfg[f.k] !== RULES[f.k]) ||
      JSON.stringify(cfg.roulette) !== JSON.stringify((RULES.roulette || []).map((x) => ({ kind: x.kind, value: x.value }))) ||
      JSON.stringify(cfg.practiceBoss) !== JSON.stringify({ name: rp.name, desc: rp.desc, hp: rp.hp, stats: rp.stats, hint: rp.hint, reveal: rp.reveal }) ||
      JSON.stringify(pool) !== JSON.stringify((RULES.bossPool || []).map(bossOut));
    const bossChanged = JSON.stringify(bosses) !== JSON.stringify(BOSSES.map(bossOut));
    if (!cfgChanged && !bossChanged) { setDraft = null; toast("바뀐 내용이 없어요"); return; }
    if (cfgChanged && !(await backend.host("saveConfig", null, cfg))) return;
    if (bossChanged && !(await backend.host("saveBosses", null, bosses))) { if (cfgChanged) toast("규칙은 저장됐지만 보스는 저장하지 못했어요"); return; }
    setDraft = null;
    toast("저장했어요. 모든 화면에 바로 적용돼요");
  }
  async function onSetButton(what, i) {
    const L = setDraft && setDraft.bosses;
    if (what === "save") { await saveSettings(); return; }
    if (what === "revert") { setDraft = null; return; }
    if (what === "defaults") {
      if (!confirm("보스 목록과 출전 보스를 기본값(직장 빌런 9명 출전)으로 되돌릴까요? 고치거나 새로 만든 보스가 모두 사라져요.")) return;
      if (await backend.host("resetBosses")) { setDraft = null; toast("보스를 기본값으로 되돌렸어요"); }
      return;
    }
    if (what === "infoFill" && setDraft) {
      setDraft.texts.infoText = infoToText(defaultInfoSections());
      if (!setDraft.texts.infoTitle) setDraft.texts.infoTitle = DEFAULT_INFO_TITLE;
      setDraft.dirty = true;
      return;
    }
    if (what === "rulesFill" && setDraft) {
      setDraft.texts.rulesLines = defaultRuleLines().join("\n");
      if (!setDraft.texts.rulesTitle) setDraft.texts.rulesTitle = defaultRulesTitle();
      setDraft.dirty = true;
      return;
    }
    const R = setDraft && setDraft.roulette;
    if (R && ["sadd", "sdel", "sup", "sdown"].includes(what)) {
      if (what === "sadd" && R.length < 10) R.push({ kind: "power", value: "1" });
      else if (what === "sdel" && R.length > 2) R.splice(i, 1);
      else if (what === "sup" && i > 0) R.splice(i - 1, 0, R.splice(i, 1)[0]);
      else if (what === "sdown" && i < R.length - 1) R.splice(i + 1, 0, R.splice(i, 1)[0]);
      else return;
      setDraft.dirty = true;
      return;
    }
    if (!L) return;
    if (what === "open" && L[i]) { L[i].open = !L[i].open; const n = String(L[i].name).trim(); if (L[i].open) openBoss.add(n); else openBoss.delete(n); return; }   // 펼치기는 저장할 내용이 아님
    if (what === "add" && L.length < POOL_MAX) L.push(newBoss());
    else if (what === "del" && L.length > 1) { if (!confirm("보스 '" + L[i].name + "'를 목록에서 지울까요? 다시 고를 수 없어요. 출전만 빼려면 체크를 풀어 주세요. (저장해야 반영돼요)")) return; L.splice(i, 1); }
    else if (what === "up" && i > 0) L.splice(i - 1, 0, L.splice(i, 1)[0]);
    else if (what === "down" && i < L.length - 1) L.splice(i + 1, 0, L.splice(i, 1)[0]);
    else return;
    setDraft.dirty = true;
  }

  // BGM (js/raid-sim-bgm.js): 발표 화면(screen.html)에서만. 단계에 맞는 곡, 결과 공개 때 타격·격파 효과음
  const bgmOn = () => !!(window.RaidSimBgm && window.RaidSimBgm.enabled);
  let sfxKey = "", afterTrack = "", afterAt = 0;
  const curSfxKey = () => !game ? "" : game.phase === "revealed" ? "r" + game.round : game.phase === "rolled" ? "d" + game.round : "";
  function syncBgm() {
    const B = window.RaidSimBgm, g = game;
    if (!B || !mounts.some((m) => m.kind === "screen")) return;
    const key = curSfxKey();
    if (key && key !== sfxKey) {
      if (key[0] === "d") { if (rolling()) B.sfx("land", (g.rollAt + ROLL_MS - now()) / 1000); }   // 룰렛이 멈추는 순간에 맞춰
      else {
        // 게이지가 차는 동안 점점 빨라지는 타격 + 올라가는 소리, 끝에 격파/실패 효과음, 그 뒤 격파·전멸 곡
        const win = (g.results[g.round] || []).some((x) => x.cleared);
        B.sfx("charge", 0.8);
        B.sfx(win ? "ko" : "fail", 3.4);
        afterTrack = win ? "win" : "lose"; afterAt = Date.now() + 4300;
        setTimeout(() => syncBgm(), 4400);
      }
    }
    sfxKey = key;
    const st = !g ? "lobby" : g.stage;
    B.setTrack(st === "lobby" ? "lobby" : st === "make" ? "make" : st === "share" ? "share" : g.phase === "idle" ? "rules"
      : g.phase === "meeting" ? (g.round === 0 ? "practice" : "meeting") : g.phase === "closed" ? "wait" : g.phase === "rolled" ? (rolling() ? "dice" : "wait")
      : g.phase === "revealed" ? (afterTrack && Date.now() >= afterAt ? afterTrack : "none") : g.phase === "final" ? "victory" : "lobby");
  }

  const lostNote = () => (MODE === "supabase" && !connected ? '<div class="notice">실시간 연결이 끊겼어요. 다시 연결하는 중…</div>' : "");
  const liveWord = () => MODE === "local" ? "미리보기 · 이 브라우저 안에서만 동작" : MODE === "supabase" ? (connected ? "실시간 연결됨 · 휴대폰·발표 화면과 같은 데이터" : "실시간 연결이 끊김 · 다시 연결하는 중") : (setupError || "연결하는 중…");

  // ── 화면별 그리기 ───────────────────────────────────────────────
  // 관리 화면 '보스 레이드' 탭: 단계 버튼 · 발표 화면 미리보기 · 판정표 (미리보기 모드에서는 휴대폰 미리보기도)
  function hostMountHtml() {
    if (!ready.state) return '<section class="panel"><h2>보스 레이드</h2><p class="small">' + esc(setupError || "불러오는 중…") + "</p></section>";
    const preview = MODE === "local" && game && personList().length && personList().length <= 12;
    return '<section class="panel hostbar"><div class="hb-l"><span class="step">' + esc(stepWord()) + '</span><span class="live' + (connected ? " on" : "") + '"><i></i>' + esc(liveWord()) + "</span></div>" +
      '<div class="actions">' + (isHost ? hostButtons().map((x) => '<button type="button" class="btn ' + (x.cls || "") + '" data-host="' + x.fn + '">' + esc(x.label) + "</button>").join("") : '<span class="small">' + esc(hostError || "관리자 비밀번호로 확인하는 중…") + "</span>") + "</div></section>" +
      '<div class="top"><section class="panel"><h2>발표 화면 미리보기</h2><div class="proj-box"><div class="proj">' + projHtml() + "</div></div>" +
      '<p class="small">프로젝터에 발표 화면(screen.html)을 띄워 두면 메인 관제가 <b>보스 레이드</b>일 때 이 화면이 그대로 나와요. BGM은 발표 화면 오른쪽 아래 버튼으로 켜요.</p></section>' +
      '<section class="panel"><h2>진행자 전용 (참여자에게는 안 보임)</h2>' + adminHtml() + "</section></div>" +
      (preview ? '<section class="panel"><h2>휴대폰 ' + personList().length + '대 미리보기</h2><p class="small">미리보기 모드라 여기서 눌러 보며 진행해 볼 수 있어요.</p><div class="phones">' +
        TEAMS.map((tn, t) => '<div class="team-group"><div class="team-label">' + tn + '</div><div class="team-phones">' + teamOf(t).map((p) =>
          '<div class="phone"><div class="phone-bar"><b>' + esc(p.name) + "</b><span>" + tn + '</span></div><div class="screen" id="screen-' + p.id + '">' + phoneHtml(p.id) + "</div></div>").join("") + "</div></div>").join("") +
        "</div></section>" : "");
  }
  function settingsMountHtml() {
    if (!canSettings()) return '<section class="panel"><h2>레이드 설정</h2><p class="small">' + esc(hostError || setupError || "관리자 비밀번호로 확인하는 중…") + "</p></section>";
    return settingsHtml();
  }
  // 발표 화면: 메인 관제가 '보스 레이드'일 때 워드클라우드 대신
  function screenMountHtml() {
    return '<div class="screen-only"><div class="proj-box"><div class="proj">' + (ready.state ? projHtml() : '<div class="pv pv-center"><div class="sub">' + esc(setupError || "불러오는 중…") + "</div></div>") + "</div></div>" +
      '<button type="button" class="bgm-float" data-bgm>' + (bgmOn() ? "♪ BGM 끄기" : "♪ BGM 켜기") + "</button></div>";
  }
  // 참여 화면: 내 휴대폰 (Knox ID 로 자동 입장)
  function phoneMountHtml() {
    const wrap = (inner) => '<div class="pwrap"><div class="screen">' + inner + lostNote() + "</div>" + (infoOpen ? infoHtml() : "") + "</div>";
    if (!ready.state) return wrap(setupError ? '<h3>보스 레이드를<br>불러오지 못했어요</h3><div class="muted">' + esc(setupError) + "</div>" : "<h3>불러오는 중…</h3>");
    if (!game || !personList().length) return wrap('<h3>보스 레이드가<br>곧 시작돼요</h3><div class="card"><div class="muted">진행자가 준비하고 있어요. 준비되면 이 화면이 자동으로 바뀌어요.</div></div>');
    const me = myPid != null ? people[myPid] : null;
    if (me && (me.claimed === false || (myName && me.name !== myName))) myPid = null;
    if (myPid == null || !people[myPid]) {
      setTimeout(ensureLogin, 0);
      return wrap(loginState === "none"
        ? '<h3>보스 레이드 명단에서<br>찾지 못했어요</h3><div class="card"><div class="muted">입장한 Knox ID가 보스 레이드 명단에 없어요. 조가 배정됐는지 진행자에게 알려 주세요. 명단에 들어가면 자동으로 입장돼요.</div></div>'
        : "<h3>보스 레이드에<br>입장하는 중…</h3>");
    }
    return '<div class="pwrap"><div class="pbar"><b>보스 레이드</b>' + infoBtn + '</div><div class="screen">' + phoneHtml(myPid) + lostNote() + "</div>" + (infoOpen ? infoHtml() : "") + "</div>";
  }

  const mounts = [];
  const qsaAll = (sel) => mounts.flatMap((m) => [...m.root.querySelectorAll(sel)]);
  const htmlFor = (m) => m.kind === "host" ? hostMountHtml() : m.kind === "settings" ? settingsMountHtml() : m.kind === "screen" ? screenMountHtml() : phoneMountHtml();
  function render() {
    syncBgm();
    maybeAutoStory();
    maybeDraftStories();
    mounts.forEach((m) => {
      const html = htmlFor(m);
      if (html === m.last) return;
      const root = m.root, scrolls = {};
      root.querySelectorAll(".screen[id]").forEach((el) => { scrolls[el.id] = el.scrollTop; });
      const ae = root.activeElement, af = ae && ae.dataset ? ae.dataset.f : null;
      let sel = null;
      try { if (af && ae.selectionStart != null) sel = [ae.selectionStart, ae.selectionEnd]; } catch (e) { /* 숫자 칸 */ }
      m.last = html;
      const scene = sceneKey(m);
      m.body.classList.toggle("settled", m.scene === scene);
      m.scene = scene;
      m.body.innerHTML = html;
      measureFolds(root);
      root.querySelectorAll(".screen[id]").forEach((el) => { if (scrolls[el.id]) el.scrollTop = scrolls[el.id]; });
      if (af) {
        const el = root.querySelector('[data-f="' + af + '"]');
        if (el) { el.focus({ preventScroll: true }); try { if (sel) el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* 숫자 칸 */ } }
      }
    });
    scheduleRollEnd();
    tick();
  }
  // 같은 장면인지: 장면이 바뀔 때만 애니메이션을 틀고, 같은 장면을 다시 그릴 때는 끝난 모습으로 (css/raid.css 의 .settled)
  const sceneKey = (m) => !game ? "none" : [game.stage, game.phase, game.round, rolling() ? "spin" : "", m.kind === "phone" ? myPid : game.view || 0].join("|");
  // 긴 글: 두 줄을 넘칠 때만 "더 보기"/"접기"
  function measureFolds(root) {
    root.querySelectorAll(".fold").forEach((f) => {
      const t = f.querySelector(".ftxt"), b = f.querySelector(".more");
      if (!t || !b || !t.clientHeight) return;
      const lh = parseFloat(getComputedStyle(t).lineHeight) || 20;
      b.hidden = !(f.classList.contains("open") ? t.scrollHeight > lh * 2 + 2 : t.scrollHeight > t.clientHeight + 1);
    });
  }
  function invalidate() { mounts.forEach((m) => { m.last = ""; }); render(); }

  // ── 누르기 ──────────────────────────────────────────────────────
  addEventListener("keydown", (e) => { if (e.key === "Escape" && infoOpen) { infoOpen = false; invalidate(); } });
  let hostBusy = false;
  // AI 서술: 마감하면 Gemini 에게 부탁해 결과 공개 전까지 만들어 둡니다 (Edge Function raid-sim 의 story). 미리보기 모드는 간단한 문장으로.
  let storyBusy = false, storyError = "";
  function localStory(x, b) {
    const c = charOf(people[x.pid] || {}), st = (b.stats || []).map((k) => ({ k, v: c[k] || 0 })).sort((p, q) => q.v - p.v);
    const hi = st[0], lo = st[st.length - 1];
    return x.cleared ? x.name + " 님은 " + LABEL[hi.k] + " " + hi.v + "의 힘으로 끝까지 밀어붙여 " + b.name + "을(를) 무너뜨렸어요."
      : x.name + " 님은 " + LABEL[lo.k] + "이(가) " + lo.v + "에 그쳐 마지막 고비를 넘지 못했어요. " + (b.hp - x.power) + "점만 더 있었으면!";
  }
  // 지금 판정의 서명 (다시 마감하면 바뀜)
  const storySig = () => { const rows = (game && game.results[game.round]) || []; return game ? game.round + "|" + rows.map((x) => x.pid + ":" + x.power).join(",") : ""; };
  let storyTried = "";
  // 마감한 뒤 서술이 하나도 없으면 (예전 화면으로 마감했거나, 마감 요청이 끊겼을 때) 진행자 화면이 자동으로 한 번 부탁합니다
  function maybeAutoStory() {
    if (MODE !== "supabase" || !isHost || storyBusy || !game || game.stage !== "boss" || !["closed", "rolled", "revealed"].includes(game.phase)) return;
    if (!mounts.some((m) => m.kind === "host")) return;
    const rows = game.results[game.round] || [];
    if (!rows.length || rows[0].power == null || rows.every((x) => x.story)) return;
    if (storyTried === storySig()) return;
    setTimeout(requestStories, 0);
  }
  // 회의 중: 출전자가 정해진 조는 4초 동안 바뀌지 않으면 AI 서술을 미리 써 둡니다 (바뀐 조만 다시)
  let draftTimer = null, draftSig = "", draftBusy = false, draftFailSig = "";
  function maybeDraftStories() {
    if (MODE !== "supabase" || !isHost || !game || game.stage !== "boss" || game.phase !== "meeting" || !mounts.some((m) => m.kind === "host")) return;
    const dr = STORY_DRAFTS["r" + game.round] || {};
    const need = TEAMS.map((_, t) => t).filter((t) => { const k = pickOf(game.round, t); return k && (!dr[t] || dr[t].pid !== k.pid); });
    const sig = game.round + "|" + need.map((t) => t + ":" + pickOf(game.round, t).pid).join(",");
    if (!need.length) { clearTimeout(draftTimer); draftSig = ""; return; }
    if (draftBusy || sig === draftSig || sig === draftFailSig) return;
    draftSig = sig;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(async () => {
      draftBusy = true;
      try { apply(await callAdmin("story", null, { mode: "draft", teams: need }), true); draftFailSig = ""; }
      catch (e) { draftFailSig = sig; }
      draftBusy = false; draftSig = ""; render();
    }, 4000);
  }
  async function requestStories() {
    if (storyBusy) return;
    storyTried = storySig();
    if (MODE === "local") {
      const g = LOCAL.S.game, b = game.round === 0 ? PRACTICE : BOSSES[game.round - 1];
      (g.results[g.round] || []).forEach((x) => { x.story = localStory(x, b || {}); });
      apply(LOCAL.engine.snapshot(LOCAL.S, true), true);
      return;
    }
    storyBusy = true; storyError = ""; invalidate();
    try { apply(await callAdmin("story"), true); }
    catch (e) { storyError = e.message; }
    storyBusy = false; invalidate();
  }
  async function onClick(e) {
    if (e.target.closest("[data-info]")) { infoOpen = true; invalidate(); return; }
    if (e.target.closest("[data-bgm]")) { if (window.RaidSimBgm) { window.RaidSimBgm.toggle(); sfxKey = curSfxKey(); } invalidate(); return; }
    const mb = e.target.closest("[data-more]");
    if (mb) { const k = mb.dataset.more; if (moreOpen.has(k)) moreOpen.delete(k); else moreOpen.add(k); invalidate(); return; }
    const ic = e.target.closest("[data-info-close]");
    if (ic && (ic.classList.contains("info-btn") || e.target === ic)) { infoOpen = false; invalidate(); return; }
    const sb = e.target.closest("[data-set]");
    if (sb) {
      if (sb.disabled || setBusy) return;
      const [what, idx] = sb.dataset.set.split(":");
      setBusy = true;
      try { await onSetButton(what, Number(idx)); } finally { setBusy = false; invalidate(); }
      return;
    }
    const hb = e.target.closest("[data-host]");
    if (hb) {
      const [fn, arg] = hb.dataset.host.split(":");
      if (fn === "back" && !confirm(game && game.phase === "closed" ? "마감을 취소하고 회의로 돌아갈까요? 이번 라운드 판정은 마감할 때 다시 해요." : "한 단계 전으로 돌아갈까요?")) return;
      if (fn === "reset" && !confirm("처음부터 다시 할까요? 캐릭터와 결과가 모두 지워져요.")) return;
      if (!hostBusy) {
        hostBusy = true; hb.disabled = true;
        let ok = false;
        try { ok = await backend.host(fn, arg ? Number(arg) : undefined); } finally { hostBusy = false; invalidate(); }
        if (ok && fn === "close") requestStories();
      }
      return;
    }
    if (e.target.closest("[data-story]")) { if (!storyBusy) requestStories(); return; }
    const b = e.target.closest("[data-a]");
    if (b && !b.disabled) personAct(Number(b.dataset.p), b.dataset.a, b.dataset.a === "pick" ? Number(b.dataset.m) : b.dataset.k);
  }
  function mount(el, kind) {
    if (!el) return null;
    const root = el.shadowRoot || el.attachShadow({ mode: "open" });
    root.innerHTML = '<link rel="stylesheet" href="css/raid.css?v=' + V + '"><div class="rs rs-' + kind + '" data-body></div>';
    const m = { el, root, kind, body: root.querySelector("[data-body]"), last: "" };
    root.addEventListener("click", (e) => onClick(e, m));
    root.addEventListener("input", (e) => onInput(e, m));
    root.addEventListener("change", (e) => onChange(e, m));
    // 화면 크기가 바뀌거나 숨겨졌던 탭이 보이면 "더 보기"를 다시 잼
    if (window.ResizeObserver) new ResizeObserver(() => measureFolds(root)).observe(el);
    mounts.push(m);
    return m;
  }

  async function loadPublic() {
    const { data, error } = await SB.from("raid_sim_public").select("data, rev").eq("id", 1).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("no row");
    return data;
  }
  let lastRev = -1;
  // 워크샵 플랫폼에서 넘어온 화면(?from=join · ?from=screen)은 진행자가 메인 관제에서 "보스 레이드"가 아닌 프로그램을 고르면
  // 참여 화면(./) · 발표 화면(screen.html)으로 돌아갑니다.
  async function connectSupabase() {
    SB = (window.WC && window.WC.db) || window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
    try {
      const row = await loadPublic();
      lastRev = row.rev;
      MODE = "supabase";
      onPublic(row.data, false);
    } catch (e) {
      if (/raid_sim_public|relation|schema cache|no row/i.test(String(e && e.message))) {
        setupError = "보스 레이드 표가 없어요. Supabase SQL Editor 에서 supabase/raid-sim.sql 을 실행해 주세요.";
      } else setupError = "Supabase 에 연결하지 못했어요 (" + ((e && e.message) || "오류") + ").";
      return false;
    }
    SB.channel("raid-sim-" + Math.random().toString(36).slice(2, 8))
      .on("postgres_changes", { event: "*", schema: "public", table: "raid_sim_public" }, (p) => {
        if (p.new && p.new.data && p.new.rev > lastRev) { lastRev = p.new.rev; onPublic(p.new.data, true); }
      })
      .subscribe((status) => {
        const was = connected;
        connected = status === "SUBSCRIBED";
        if (was !== connected) { invalidate(); }
      });
    // Realtime 이 잠깐 끊겨도 놓치지 않도록 10초마다 한 번 확인
    setInterval(async () => {
      try { const row = await loadPublic(); if (row.rev > lastRev) { lastRev = row.rev; onPublic(row.data, false); } } catch (e) { /* 다음에 */ }
    }, 10000);
    return true;
  }
  function startLocal() {
    return new Promise((done) => {
    const s = document.createElement("script");
    s.src = "js/raid-sim-engine.js?v=" + V;
    s.onload = () => {
      const E = window.RaidSimEngine, S = E.create();
      E.host(S, "setup");
      LOCAL = { engine: E, S };
      MODE = "local"; isHost = true; connected = true;
      apply(E.snapshot(S, true), true);
      done();
    };
    s.onerror = () => { toast("js/raid-sim-engine.js 를 불러오지 못했어요."); done(); };
    document.head.appendChild(s);
    });
  }
  let startP = null;
  function start(local) {
    if (!startP) startP = local ? startLocal() : connectSupabase().then((ok) => { if (!ok) invalidate(); });
    return startP;
  }

  return {
    // 관리 화면: host = '보스 레이드' 탭, settings = '레이드 설정' 탭, password() = 관리 화면의 관리자 비밀번호, demo = 서버 없는 미리보기
    mountAdmin(opts) {
      if (opts.password) getPassword = opts.password;
      mount(opts.host, "host");
      mount(opts.settings, "settings");
      render();
      start(!!opts.demo).then(() => { if (MODE === "supabase") hostAct("state"); });
    },
    // 발표 화면
    mountScreen(el) { mount(el, "screen"); render(); start(false); },
    // 참여 화면: knoxId = 워크샵에 입장한 Knox ID
    mountPhone(el, opts) {
      myKnox = opts && opts.knoxId ? String(opts.knoxId).toLowerCase() : null;
      mount(el, "phone"); render(); start(false);
    },
    setKnox(id) {
      const v = id ? String(id).toLowerCase() : null;
      if (v === myKnox) return;
      myKnox = v; myPid = null; myName = null; loginState = ""; invalidate();
    },
  };
})();
