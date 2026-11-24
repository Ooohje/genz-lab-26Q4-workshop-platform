// 보스 레이드 시뮬레이터의 규칙과 진행 상태 (스탯 판정, AI 없음).
// raid-sim.html 의 연습 모드(?local 또는 Supabase 에 연결할 수 없을 때)에서 브라우저가 직접 씁니다. Supabase 판정은 supabase/raid-sim.sql.
// 판정 규칙은 supabase/raid.sql 과 같습니다.
//   공격력 = 판정 스탯 합 (+돌발 이벤트 주사위: 1이면 −2, 6이면 +3). 보스 체력 이상이면 격파 → 보상 점수.
//   라운드 공격력 1위 조는 MVP +1점. 순위는 총점, 같으면 공격력 합.
(function (root) {
  "use strict";

  const KEYS = ["hp", "intel", "social", "mental"];
  const TEAMS = ["A조", "B조"];
  const DEFAULT_NAMES = ["참여자 1", "참여자 2", "참여자 3", "참여자 4", "참여자 5", "참여자 6"];
  const SEATS = DEFAULT_NAMES.length;
  const MEETING_SEC = 180, SHARE_MIN = 8;
  // stats · hint · reveal 은 결과 공개 전까지 참여자에게 보내지 않습니다 (snapshot 참고).
  const BOSSES = [
    { name: "무한 회의 루프 '리:미팅'", desc: "회의가 끝나면 '방금 회의를 정리하는 회의'가 소환된다. 아무도 결론을 말하지 않는다.", hp: 11, reward: 1, event: false, stats: ["hp", "mental"], hint: "끝까지 남는 사람이 이긴다.", reveal: "결론을 내는 게 아니라 끝까지 버티는 게 승리였습니다." },
    { name: "알림 폭탄 '안읽음 999+'", desc: "점심 먹고 왔더니 단톡방 9개에 안 읽은 메시지가 999개. 그중 하나는 팀장님의 \"이거 확인 가능?\"", hp: 12, reward: 2, event: false, stats: ["intel", "mental"], hint: "999개를 다 읽을 필요는 없다.", reveal: "중요한 하나를 골라내고, 나머지에 흔들리지 않아야 했습니다." },
    { name: "팀장님의 '편하게 얘기해 봐요'", desc: "회의 끝 무렵, 팀장님이 웃으며 말한다. \"부담 갖지 말고 편하게 얘기해 봐요.\" 회의실이 조용해진다.", hp: 12, reward: 2, event: false, stats: ["intel", "social"], hint: "아무 말도 안 하면 지고, 아무 말이나 해도 진다.", reveal: "할 말을 정리하는 힘과, 분위기에 맞게 꺼내는 힘이 필요했습니다." },
    { name: "금요일 17:58 '긴급 수정 요청'", desc: "퇴근 2분 전 도착한 메일. 제목: [긴급] 최종_진짜최종_수정본 확인 부탁드립니다.", hp: 13, reward: 3, event: true, stats: ["social", "hp"], hint: "혼자 하면 밤 10시, 같이 하면 7시.", reveal: "혼자 안고 가지 말고 동료를 불러서 같이 끝내는 게 정답이었습니다." },
    { name: "최종 보스: 연말 회식 '건배사 지명'", desc: "1차, 2차, 노래방까지 이어진 연말 회식. 자정 무렵 마이크가 나에게 넘어온다. \"자, 올해 마무리 한마디!\"", hp: 16, reward: 4, event: true, stats: ["hp", "social", "mental"], hint: "이 자리에서 머리를 쓰는 사람은 없다.", reveal: "자정까지 버티고, 분위기를 읽고, 떨지 않아야 합니다. 지력만 빠졌습니다." },
  ];

  const rand = (n) => Math.floor(Math.random() * n);
  const newSeed = () => 1 + rand(2147483000);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  function randomStats() {
    for (;;) {
      const a = [1, 1, 1, 1];
      for (let k = 0; k < 16; k++) a[rand(4)]++;
      if (Math.max(...a) <= 10) return { hp: a[0], intel: a[1], social: a[2], mental: a[3] };
    }
  }
  const initialGame = () => ({ v: 1, stage: "lobby", round: 0, phase: "idle", hint: false, deadline: null, shareDeadline: null, locked: false, results: {} });

  // S = { game, people: {0..5}, picks: {"r{라운드}t{조}": {pid, by, auto}} }
  const create = () => ({ game: null, people: {}, picks: {} });
  const personList = (S) => Object.keys(S.people).map(Number).sort((a, b) => a - b).map((i) => S.people[i]);
  const teamOf = (S, t) => personList(S).filter((p) => p.team === t);
  const pickOf = (S, r, t) => S.picks["r" + r + "t" + t];
  function played(S, pid, before) {
    for (let r = 1; r < before; r++) for (let t = 0; t < TEAMS.length; t++) { const k = pickOf(S, r, t); if (k && k.pid === pid) return true; }
    return false;
  }
  const canPick = (S, pid, t) => !played(S, pid, S.game.round) || teamOf(S, t).every((m) => played(S, m.id, S.game.round));
  const charOf = (p) => p.char || { hp: 5, intel: 5, social: 5, mental: 5, seed: p.seed || 1, isDefault: true };
  const validStats = (c) => c && KEYS.every((k) => Number.isInteger(c[k]) && c[k] >= 1 && c[k] <= 10) && KEYS.reduce((n, k) => n + c[k], 0) === 20;

  function lockCharacters(S) {
    personList(S).forEach((p) => { if (!p.char) p.char = { hp: 5, intel: 5, social: 5, mental: 5, seed: p.seed, isDefault: true }; });
  }
  function clearPicksFrom(S, r) {
    Object.keys(S.picks).forEach((key) => { const m = key.match(/^r(\d+)t\d+$/); if (m && Number(m[1]) >= r) delete S.picks[key]; });
  }
  function closeRound(S) {
    const g = S.game, r = g.round, b = BOSSES[r - 1];
    for (let t = 0; t < TEAMS.length; t++) {
      if (pickOf(S, r, t)) continue;
      // 안 고른 조는 아직 안 나간 사람 중 랜덤
      const pool = teamOf(S, t).filter((m) => !played(S, m.id, r));
      const list = pool.length ? pool : teamOf(S, t);
      S.picks["r" + r + "t" + t] = { pid: list[rand(list.length)].id, by: null, auto: true };
    }
    const rows = TEAMS.map((_, t) => {
      const k = pickOf(S, r, t), p = S.people[k.pid], c = charOf(p);
      const base = b.stats.reduce((n, s) => n + c[s], 0);
      const dice = b.event ? 1 + rand(6) : null;
      const bonus = dice === 1 ? -2 : dice === 6 ? 3 : 0;
      const power = base + bonus;
      return { team: t, pid: p.id, name: p.name, base, dice, bonus, power, cleared: power >= b.hp, auto: !!k.auto };
    });
    const max = Math.max(...rows.map((x) => x.power));
    rows.forEach((x) => { x.mvp = x.power === max; x.points = (x.cleared ? b.reward : 0) + (x.mvp ? 1 : 0); });
    g.results[r] = rows;
    g.phase = "closed";
    g.deadline = null;
  }

  // ── 진행자 동작 ── 실패하면 사유(문자열)를 돌려줍니다.
  const HOST = {
    setup(S) {
      S.people = {};
      for (let i = 0; i < SEATS; i++) S.people[i] = { id: i, name: DEFAULT_NAMES[i], team: i < SEATS / 2 ? 0 : 1, char: null, seed: newSeed(), rerolls: 0, claimed: false };
      S.picks = {};
      S.game = initialGame();
    },
    make(S) { if (S.game.stage !== "lobby") return "대기 단계에서만 시작할 수 있어요"; S.game.stage = "make"; },
    fillChars(S) {
      if (S.game.locked) return "캐릭터가 이미 잠겼어요";
      personList(S).forEach((p) => { if (!p.char) p.char = Object.assign(randomStats(), { seed: p.seed }); });
    },
    share(S) { if (S.game.stage !== "make") return "캐릭터 만들기 다음에 넘길 수 있어요"; Object.assign(S.game, { stage: "share", shareDeadline: Date.now() + SHARE_MIN * 60000 }); },
    raid(S) {
      if (S.game.stage !== "share" && S.game.stage !== "make") return "조 내 공유 다음에 넘길 수 있어요";
      lockCharacters(S);
      Object.assign(S.game, { stage: "boss", round: 0, phase: "idle", locked: true });
    },
    start(S, r) {
      const g = S.game;
      const ok = g.stage === "boss" && Number.isInteger(r) && r >= 1 && r <= BOSSES.length &&
        ((r === 1 && (g.phase === "idle" || !g.round)) || (r === g.round && g.phase === "closed") || (r === g.round + 1 && g.phase === "revealed"));
      if (!ok) return "지금은 " + r + "번 보스를 시작할 수 없어요";
      lockCharacters(S);
      clearPicksFrom(S, r);
      Object.keys(g.results).forEach((k) => { if (Number(k) >= r) delete g.results[k]; });
      Object.assign(g, { round: r, phase: "meeting", hint: false, locked: true, deadline: Date.now() + MEETING_SEC * 1000 });
    },
    hint(S) { if (S.game.phase !== "meeting") return "회의 중에만 힌트를 열 수 있어요"; S.game.hint = true; },
    close(S) { if (S.game.phase !== "meeting") return "회의 중에만 마감할 수 있어요"; closeRound(S); },
    reveal(S) { if (S.game.phase !== "closed") return "마감한 뒤에 공개할 수 있어요"; S.game.phase = "revealed"; },
    final(S) { if (S.game.phase !== "revealed") return "결과 공개 뒤에 최종 순위를 띄울 수 있어요"; S.game.phase = "final"; },
    reset(S) {
      S.picks = {};
      personList(S).forEach((p) => { p.char = null; p.rerolls = 0; });
      S.game = initialGame();
    },
    resetSeats(S) { personList(S).forEach((p) => { p.name = DEFAULT_NAMES[p.id]; p.claimed = false; }); },
  };
  function host(S, fn, arg) {
    if (!Object.prototype.hasOwnProperty.call(HOST, fn)) return "알 수 없는 동작이에요";
    if (fn !== "setup" && (!S.game || !personList(S).length)) return "먼저 게임을 준비해 주세요";
    return HOST[fn](S, arg) || null;
  }

  // ── 참여자 동작 (자기 자리, 우리 조 출전자) ──
  function act(S, pid, a, data) {
    const g = S.game, p = S.people[pid];
    if (!g || !p) return "자리를 찾을 수 없어요";
    const d = data || {};
    if (a === "claim") {
      const clean = String(d.name || "").replace(/\s+/g, " ").trim().slice(0, 12);
      p.claimed = true;
      if (clean) p.name = clean;
      return null;
    }
    if (a === "save") {
      if (g.locked || (g.stage !== "make" && g.stage !== "share")) return "지금은 캐릭터를 바꿀 수 없어요";
      const c = d.stats && { hp: d.stats.hp, intel: d.stats.intel, social: d.stats.social, mental: d.stats.mental };
      if (!validStats(c)) return "스탯은 하나에 1~10점, 합계 20점이어야 해요";
      p.char = Object.assign(c, { seed: p.seed });
      return null;
    }
    if (a === "reroll") {
      if (g.locked || (g.stage !== "make" && g.stage !== "share")) return "지금은 다시 뽑을 수 없어요";
      if (!p.char || p.rerolls >= 2) return "다시 뽑기를 모두 썼어요";
      p.seed = newSeed();
      p.rerolls += 1;
      p.char = Object.assign({}, p.char, { seed: p.seed });
      return null;
    }
    if (a === "pick") {
      const m = S.people[d.m];
      if (g.phase !== "meeting") return "회의 시간이 끝났어요";
      if (!m || m.team !== p.team) return "우리 조원만 고를 수 있어요";
      if (!canPick(S, m.id, p.team)) return "이미 출전한 사람이에요";
      S.picks["r" + g.round + "t" + p.team] = { pid: m.id, by: pid, auto: false };
      return null;
    }
    return "알 수 없는 동작이에요";
  }

  // 화면에 보낼 상태. 진행자가 아니면 결과 공개 전 라운드의 판정 스탯과 공격력을 뺍니다.
  function snapshot(S, isHost) {
    const g = S.game ? clone(S.game) : null;
    const open = (r) => !!g && (r < g.round || (r === g.round && (g.phase === "revealed" || g.phase === "final")));
    const bosses = BOSSES.map((b, i) => {
      const r = i + 1;
      const pub = { name: b.name, desc: b.desc, hp: b.hp, reward: b.reward, event: b.event, nStats: b.stats.length };
      if (isHost || open(r)) Object.assign(pub, { stats: b.stats.slice(), hint: b.hint, reveal: b.reveal });
      else if (g && g.hint && r === g.round) pub.hint = b.hint;
      return pub;
    });
    if (g && !isHost) {
      Object.keys(g.results || {}).forEach((k) => {
        if (!open(Number(k))) g.results[k] = g.results[k].map((x) => ({ team: x.team, pid: x.pid, name: x.name, auto: x.auto }));
      });
    }
    return { game: g, people: clone(S.people), picks: clone(S.picks), bosses, isHost: !!isHost, now: Date.now() };
  }

  const api = { KEYS, TEAMS, BOSSES, create, host, act, snapshot, randomStats };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RaidSimEngine = api;
})(typeof window !== "undefined" ? window : this);
