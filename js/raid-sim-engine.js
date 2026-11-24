// 보스 레이드 시뮬레이터의 규칙과 진행 상태 (스탯 판정, AI 없음).
// raid-sim.html 의 연습 모드(?local 또는 Supabase 에 연결할 수 없을 때)에서 브라우저가 직접 씁니다. Supabase 판정은 supabase/raid-sim.sql (규칙이 같아야 합니다).
//   캐릭터 스탯 5개: 체력 · 지력 · 친화력 · 멘탈 · 운
//   공격력 = 판정 스탯 합 (+돌발 이벤트 주사위: 1이면 보스의 diceLow, 6이면 diceHigh). 보스 체력 이상이면 격파 → 보상 점수.
//   운: 돌발 이벤트 라운드에 운 luckStep 점마다 주사위를 1개 더 굴려 가장 좋은 눈을 씁니다 (luckStep 0이면 끔, 최대 5개).
//   라운드 공격력 1위 조는 MVP 점수. 순위는 총점, 같으면 공격력 합.
(function (root) {
  "use strict";

  const KEYS = ["hp", "intel", "social", "mental", "luck"];
  const TEAMS = ["A조", "B조"];   // 명단이 없을 때 (6자리 연습판)
  const DEFAULT_NAMES = ["참여자 1", "참여자 2", "참여자 3", "참여자 4", "참여자 5", "참여자 6"];
  const SEATS = DEFAULT_NAMES.length;
  const DEFAULT_CONFIG = { statTotal: 25, statMin: 1, statMax: 10, rerolls: 2, meetingSec: 180, shareMin: 8, mvpBonus: 1, luckStep: 4 };
  // stats · hint · reveal 은 결과 공개 전까지 참여자에게 보내지 않습니다 (snapshot 참고).
  const DEFAULT_BOSSES = [
    { name: "무한 회의 루프 '리:미팅'", desc: "회의가 끝나면 '방금 회의를 정리하는 회의'가 소환된다. 아무도 결론을 말하지 않는다.", hp: 11, reward: 1, event: false, diceLow: -2, diceHigh: 3, stats: ["hp", "mental"], hint: "끝까지 남는 사람이 이긴다.", reveal: "결론을 내는 게 아니라 끝까지 버티는 게 승리였습니다." },
    { name: "알림 폭탄 '안읽음 999+'", desc: "점심 먹고 왔더니 단톡방 9개에 안 읽은 메시지가 999개. 그중 하나는 팀장님의 \"이거 확인 가능?\"", hp: 12, reward: 2, event: false, diceLow: -2, diceHigh: 3, stats: ["intel", "mental"], hint: "999개를 다 읽을 필요는 없다.", reveal: "중요한 하나를 골라내고, 나머지에 흔들리지 않아야 했습니다." },
    { name: "팀장님의 '편하게 얘기해 봐요'", desc: "회의 끝 무렵, 팀장님이 웃으며 말한다. \"부담 갖지 말고 편하게 얘기해 봐요.\" 회의실이 조용해진다.", hp: 12, reward: 2, event: false, diceLow: -2, diceHigh: 3, stats: ["intel", "social"], hint: "아무 말도 안 하면 지고, 아무 말이나 해도 진다.", reveal: "할 말을 정리하는 힘과, 분위기에 맞게 꺼내는 힘이 필요했습니다." },
    { name: "금요일 17:58 '긴급 수정 요청'", desc: "퇴근 2분 전 도착한 메일. 제목: [긴급] 최종_진짜최종_수정본 확인 부탁드립니다.", hp: 13, reward: 3, event: true, diceLow: -2, diceHigh: 3, stats: ["social", "hp"], hint: "혼자 하면 밤 10시, 같이 하면 7시.", reveal: "혼자 안고 가지 말고 동료를 불러서 같이 끝내는 게 정답이었습니다." },
    { name: "최종 보스: 연말 회식 '건배사 지명'", desc: "1차, 2차, 노래방까지 이어진 연말 회식. 자정 무렵 마이크가 나에게 넘어온다. \"자, 올해 마무리 한마디!\"", hp: 16, reward: 4, event: true, diceLow: -2, diceHigh: 3, stats: ["hp", "social", "mental"], hint: "이 자리에서 머리를 쓰는 사람은 없다.", reveal: "자정까지 버티고, 분위기를 읽고, 떨지 않아야 합니다. 지력만 빠졌습니다." },
  ];

  const rand = (n) => Math.floor(Math.random() * n);
  const newSeed = () => 1 + rand(2147483000);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  // 규칙(합계·최소·최대)에 맞는 랜덤 스탯
  function randomStats(cfg) {
    const c = cfg || DEFAULT_CONFIG, a = KEYS.map(() => c.statMin);
    for (let left = c.statTotal - c.statMin * KEYS.length; left > 0; left--) {
      let i; do { i = rand(KEYS.length); } while (a[i] >= c.statMax);
      a[i]++;
    }
    return Object.fromEntries(KEYS.map((k, i) => [k, a[i]]));
  }
  // 캐릭터를 안 만든 사람의 기본 스탯 (합계를 고르게 나눔)
  function defaultStats(cfg) {
    const t = (cfg || DEFAULT_CONFIG).statTotal, n = KEYS.length;
    return Object.fromEntries(KEYS.map((k, i) => [k, Math.floor(t / n) + (i < t % n ? 1 : 0)]));
  }
  const initialGame = () => ({ v: 1, stage: "lobby", round: 0, phase: "idle", hint: false, deadline: null, shareDeadline: null, locked: false, results: {} });

  // 규칙·보스 확인. 문제가 없으면 null, 있으면 이유. (supabase/raid-sim.sql 의 raid_sim_check_config · raid_sim_check_bosses 와 같음)
  function checkConfig(c) {
    const n = KEYS.length;
    if (!isInt(c.statMin, 1, 10)) return "스탯 최소는 1~10점이에요";
    if (!isInt(c.statMax, c.statMin, 30)) return "스탯 최대는 최소 이상, 30점 이하예요";
    if (!isInt(c.statTotal, n * c.statMin, n * c.statMax)) return "스탯 합계는 " + n * c.statMin + "~" + n * c.statMax + "점이어야 해요 (스탯 " + n + "개 × 최소~최대)";
    if (!isInt(c.rerolls, 0, 10)) return "다시 뽑기는 0~10번이에요";
    if (!isInt(c.meetingSec, 30, 1800)) return "회의 시간은 30~1800초예요";
    if (!isInt(c.shareMin, 1, 60)) return "조 내 공유 시간은 1~60분이에요";
    if (!isInt(c.mvpBonus, 0, 20)) return "MVP 점수는 0~20점이에요";
    if (!isInt(c.luckStep, 0, 30)) return "운 주사위 기준은 0~30점이에요 (0이면 끔)";
    return null;
  }
  // 명단 [{uid, name, team}] 확인 (빈 배열 = 6자리 연습판)
  function checkRoster(list) {
    if (!Array.isArray(list)) return "명단 형식이 잘못됐어요";
    if (!list.length) return null;
    if (list.length > 300) return "명단은 300명까지예요";
    const uids = new Set(), teams = new Set();
    for (let i = 0; i < list.length; i++) {
      const r = list[i], pre = i + 1 + "번째 사람: ";
      if (!r || typeof r !== "object") return pre + "형식이 잘못됐어요";
      const u = String(r.uid == null ? "" : r.uid).trim().toLowerCase(), n = String(r.name == null ? "" : r.name).trim(), t = String(r.team == null ? "" : r.team).trim();
      if (!u || u.length > 40) return pre + "아이디는 1~40자예요";
      if (uids.has(u)) return pre + "아이디 " + u + " 가 두 번 나와요";
      uids.add(u);
      if (!n || n.length > 20) return pre + "이름은 1~20자예요";
      if (!t || t.length > 20) return pre + "조 이름은 1~20자예요";
      teams.add(t);
    }
    if (teams.size < 2) return "조가 2개 이상이어야 해요";
    if (teams.size > 20) return "조는 20개까지예요";
    return null;
  }
  function checkBosses(list) {
    if (!Array.isArray(list) || list.length < 1 || list.length > 10) return "보스는 1~10명이어야 해요";
    for (let i = 0; i < list.length; i++) {
      const b = list[i], pre = i + 1 + "번 보스: ";
      if (!b || typeof b !== "object") return pre + "형식이 잘못됐어요";
      if (typeof b.name !== "string" || !b.name.trim() || b.name.length > 60) return pre + "이름은 1~60자로 적어 주세요";
      if (typeof b.desc !== "string" || b.desc.length > 300) return pre + "설명은 300자 이하예요";
      if (!isInt(b.hp, 1, 300)) return pre + "체력은 1~300이에요";
      if (!isInt(b.reward, 0, 50)) return pre + "보상 점수는 0~50점이에요";
      if (typeof b.event !== "boolean") return pre + "돌발 이벤트 값이 잘못됐어요";
      if (!isInt(b.diceLow, -50, 50) || !isInt(b.diceHigh, -50, 50)) return pre + "주사위 효과는 -50~50이에요";
      if (!Array.isArray(b.stats) || b.stats.length < 1 || b.stats.length > KEYS.length || b.stats.some((s, j) => !KEYS.includes(s) || b.stats.indexOf(s) !== j)) return pre + "판정 스탯을 1개 이상 골라 주세요";
      if (typeof b.hint !== "string" || b.hint.length > 200) return pre + "힌트는 200자 이하예요";
      if (typeof b.reveal !== "string" || b.reveal.length > 300) return pre + "공개 설명은 300자 이하예요";
    }
    return null;
  }

  // S = { game, people: {0..}, picks: {"r{라운드}t{조}": {pid, by, auto}}, teams: [조 이름], mode: "seats"|"roster", roster, config, bosses }
  const create = () => ({ game: null, people: {}, picks: {}, teams: TEAMS.slice(), mode: "seats", roster: [], config: clone(DEFAULT_CONFIG), bosses: clone(DEFAULT_BOSSES) });
  const personList = (S) => Object.keys(S.people).map(Number).sort((a, b) => a - b).map((i) => S.people[i]);
  const teamOf = (S, t) => personList(S).filter((p) => p.team === t);
  const pickOf = (S, r, t) => S.picks["r" + r + "t" + t];
  function played(S, pid, before) {
    for (let r = 1; r < before; r++) for (let t = 0; t < S.teams.length; t++) { const k = pickOf(S, r, t); if (k && k.pid === pid) return true; }
    return false;
  }
  const canPick = (S, pid, t) => !played(S, pid, S.game.round) || teamOf(S, t).every((m) => played(S, m.id, S.game.round));
  const charOf = (S, p) => p.char || Object.assign(defaultStats(S.config), { seed: p.seed || 1, isDefault: true });
  const editable = (g) => !g.locked && (g.stage === "make" || g.stage === "share");

  function lockCharacters(S) {
    personList(S).forEach((p) => { if (!p.char) p.char = charOf(S, p); });
  }
  function clearPicksFrom(S, r) {
    Object.keys(S.picks).forEach((key) => { const m = key.match(/^r(\d+)t\d+$/); if (m && Number(m[1]) >= r) delete S.picks[key]; });
  }
  function closeRound(S) {
    const g = S.game, r = g.round, b = S.bosses[r - 1], cfg = S.config;
    for (let t = 0; t < S.teams.length; t++) {
      if (pickOf(S, r, t)) continue;
      // 안 고른 조는 아직 안 나간 사람 중 랜덤
      const pool = teamOf(S, t).filter((m) => !played(S, m.id, r));
      const list = pool.length ? pool : teamOf(S, t);
      S.picks["r" + r + "t" + t] = { pid: list[rand(list.length)].id, by: null, auto: true };
    }
    const rows = S.teams.map((_, t) => {
      const k = pickOf(S, r, t), p = S.people[k.pid], c = charOf(S, p);
      const base = b.stats.reduce((n, s) => n + (c[s] || 0), 0);
      // 돌발 이벤트: 운이 높으면 주사위를 더 굴려 가장 좋은 눈
      let dice = null, bonus = 0, rolls = null;
      if (b.event) {
        const count = Math.min(5, 1 + (cfg.luckStep > 0 ? Math.floor((c.luck || 0) / cfg.luckStep) : 0));
        rolls = [];
        for (let i = 0; i < count; i++) {
          const d = 1 + rand(6), v = d === 1 ? b.diceLow : d === 6 ? b.diceHigh : 0;
          rolls.push(d);
          if (dice === null || v > bonus || (v === bonus && d > dice)) { dice = d; bonus = v; }
        }
      }
      const power = base + bonus;
      return { team: t, pid: p.id, name: p.name, base, dice, rolls, bonus, power, cleared: power >= b.hp, auto: !!k.auto };
    });
    const max = Math.max(...rows.map((x) => x.power));
    rows.forEach((x) => { x.mvp = x.power === max; x.points = (x.cleared ? b.reward : 0) + (x.mvp ? cfg.mvpBonus : 0); });
    g.results[r] = rows;
    g.phase = "closed";
    g.deadline = null;
  }

  // ── 진행자 동작 ── 실패하면 사유(문자열)를 돌려줍니다.
  const HOST = {
    // 새 판: 명단이 있으면 명단대로(조는 명단에 처음 나온 순서), 없으면 6자리
    setup(S) {
      S.people = {};
      if (S.roster.length) {
        S.teams = [];
        S.roster.forEach((r, i) => {
          if (!S.teams.includes(r.team)) S.teams.push(r.team);
          S.people[i] = { id: i, uid: r.uid, name: r.name, team: S.teams.indexOf(r.team), char: null, seed: newSeed(), rerolls: 0, claimed: false };
        });
        S.mode = "roster";
      } else {
        for (let i = 0; i < SEATS; i++) S.people[i] = { id: i, name: DEFAULT_NAMES[i], team: i < SEATS / 2 ? 0 : 1, char: null, seed: newSeed(), rerolls: 0, claimed: false };
        S.teams = TEAMS.slice();
        S.mode = "seats";
      }
      S.picks = {};
      S.game = initialGame();
    },
    saveRoster(S, _, data) {
      if (S.game && S.game.stage !== "lobby") return "명단은 대기 단계에서만 바꿀 수 있어요. 진행 탭에서 \"처음부터\"를 누른 뒤 적용해 주세요";
      const err = checkRoster(data);
      if (err) return err;
      S.roster = data.map((r) => ({ uid: String(r.uid).trim().toLowerCase(), name: String(r.name).trim(), team: String(r.team).trim() }));
      HOST.setup(S);
    },
    make(S) { if (S.game.stage !== "lobby") return "대기 단계에서만 시작할 수 있어요"; S.game.stage = "make"; },
    fillChars(S) {
      if (S.game.locked) return "캐릭터가 이미 잠겼어요";
      personList(S).forEach((p) => { if (!p.char) p.char = Object.assign(randomStats(S.config), { seed: p.seed }); });
    },
    share(S) { if (S.game.stage !== "make") return "캐릭터 만들기 다음에 넘길 수 있어요"; Object.assign(S.game, { stage: "share", shareDeadline: Date.now() + S.config.shareMin * 60000 }); },
    raid(S) {
      if (S.game.stage !== "share" && S.game.stage !== "make") return "조 내 공유 다음에 넘길 수 있어요";
      lockCharacters(S);
      Object.assign(S.game, { stage: "boss", round: 0, phase: "idle", locked: true });
    },
    start(S, r) {
      const g = S.game;
      const ok = g.stage === "boss" && Number.isInteger(r) && r >= 1 && r <= S.bosses.length &&
        ((r === 1 && (g.phase === "idle" || !g.round)) || (r === g.round && g.phase === "closed") || (r === g.round + 1 && g.phase === "revealed"));
      if (!ok) return "지금은 " + r + "번 보스를 시작할 수 없어요";
      lockCharacters(S);
      clearPicksFrom(S, r);
      Object.keys(g.results).forEach((k) => { if (Number(k) >= r) delete g.results[k]; });
      Object.assign(g, { round: r, phase: "meeting", hint: false, locked: true, deadline: Date.now() + S.config.meetingSec * 1000 });
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
    resetSeats(S) { personList(S).forEach((p) => { if (!p.uid) p.name = DEFAULT_NAMES[p.id]; p.claimed = false; }); },
    saveConfig(S, _, data) {
      if (!data || typeof data !== "object") return "규칙 형식이 잘못됐어요";
      const next = Object.assign({}, S.config);
      Object.keys(DEFAULT_CONFIG).forEach((k) => { if (k in data) next[k] = data[k]; });
      const err = checkConfig(next);
      if (err) return err;
      const g = S.game;
      if (g && g.stage !== "lobby" && ["statTotal", "statMin", "statMax"].some((k) => next[k] !== S.config[k])) return "스탯 규칙(합계·최소·최대)은 대기 단계에서만 바꿀 수 있어요. \"처음부터\"를 누르면 대기 단계로 돌아가요";
      S.config = next;
    },
    saveBosses(S, _, data) {
      const g = S.game;
      if (g && (g.phase === "meeting" || g.phase === "closed")) return "라운드 진행 중(회의·마감)에는 보스를 바꿀 수 없어요. 결과 공개 뒤에 저장해 주세요";
      const err = checkBosses(data);
      if (err) return err;
      if (g && g.stage === "boss" && data.length < g.round) return "이미 진행한 " + g.round + "라운드보다 보스 수를 줄일 수 없어요";
      S.bosses = data.map((b) => ({ name: b.name.trim(), desc: b.desc, hp: b.hp, reward: b.reward, event: b.event, diceLow: b.diceLow, diceHigh: b.diceHigh, stats: b.stats.slice(), hint: b.hint, reveal: b.reveal }));
    },
    resetBosses(S) {
      const g = S.game;
      if (g && (g.phase === "meeting" || g.phase === "closed")) return "라운드 진행 중(회의·마감)에는 보스를 바꿀 수 없어요";
      if (g && g.stage === "boss" && g.round > DEFAULT_BOSSES.length) return "이미 진행한 라운드보다 보스 수를 줄일 수 없어요";
      S.bosses = clone(DEFAULT_BOSSES);
    },
  };
  const NO_GAME_OK = ["setup", "saveConfig", "saveBosses", "resetBosses", "saveRoster"];
  function host(S, fn, arg, data) {
    if (!Object.prototype.hasOwnProperty.call(HOST, fn)) return "알 수 없는 동작이에요";
    if (!NO_GAME_OK.includes(fn) && (!S.game || !personList(S).length)) return "먼저 게임을 준비해 주세요";
    return HOST[fn](S, arg, data) || null;
  }

  // ── 참여자 동작 (자기 자리, 우리 조 출전자) ──
  function act(S, pid, a, data) {
    const g = S.game, p = S.people[pid], cfg = S.config;
    if (!g || !p) return "자리를 찾을 수 없어요";
    const d = data || {};
    if (a === "claim") {
      if (S.mode === "roster") return "아이디로 입장해 주세요";
      const clean = String(d.name || "").replace(/\s+/g, " ").trim().slice(0, 12);
      p.claimed = true;
      if (clean) p.name = clean;
      return null;
    }
    if (a === "save") {
      if (!editable(g)) return "지금은 캐릭터를 바꿀 수 없어요";
      const c = d.stats ? Object.fromEntries(KEYS.map((k) => [k, d.stats[k]])) : null;
      const ok = c && KEYS.every((k) => isInt(c[k], cfg.statMin, cfg.statMax)) && KEYS.reduce((n, k) => n + c[k], 0) === cfg.statTotal;
      if (!ok) return "스탯은 하나에 " + cfg.statMin + "~" + cfg.statMax + "점, 합계 " + cfg.statTotal + "점이어야 해요";
      p.char = Object.assign(c, { seed: p.seed });
      return null;
    }
    if (a === "reroll") {
      if (!editable(g)) return "지금은 다시 뽑을 수 없어요";
      if (!p.char || p.rerolls >= cfg.rerolls) return "다시 뽑기를 모두 썼어요";
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

  // 명단으로 만든 판: 아이디로 자리를 찾아 줍니다. { pid, name } 또는 { error }
  function login(S, uid) {
    if (S.mode !== "roster" || !S.game) return { error: "지금은 아이디 입장을 쓰지 않아요. 자리를 골라 주세요" };
    const v = String(uid || "").trim().toLowerCase();
    if (!v) return { error: "아이디를 적어 주세요" };
    const p = personList(S).find((x) => x.uid === v);
    if (!p) return { error: "명단에 없는 아이디예요. 진행자에게 알려 주세요" };
    p.claimed = true;
    return { pid: p.id, name: p.name };
  }

  // 화면에 보낼 상태. 진행자가 아니면 결과 공개 전 라운드의 판정 스탯과 공격력을 뺍니다.
  function snapshot(S, isHost) {
    const g = S.game ? clone(S.game) : null;
    const open = (r) => !!g && (r < g.round || (r === g.round && (g.phase === "revealed" || g.phase === "final")));
    const bosses = S.bosses.map((b, i) => {
      const r = i + 1;
      const pub = { name: b.name, desc: b.desc, hp: b.hp, reward: b.reward, event: b.event, diceLow: b.diceLow, diceHigh: b.diceHigh, nStats: b.stats.length };
      if (isHost || open(r)) Object.assign(pub, { stats: b.stats.slice(), hint: b.hint, reveal: b.reveal });
      else if (g && g.hint && r === g.round) pub.hint = b.hint;
      return pub;
    });
    if (g && !isHost) {
      Object.keys(g.results || {}).forEach((k) => {
        if (!open(Number(k))) g.results[k] = g.results[k].map((x) => ({ team: x.team, pid: x.pid, name: x.name, auto: x.auto }));
      });
    }
    const people = clone(S.people);
    if (!isHost) Object.values(people).forEach((p) => { delete p.uid; });   // 참여자 화면에는 아이디를 보내지 않음
    return { game: g, people, picks: clone(S.picks), teams: S.teams.slice(), mode: S.mode, bosses, config: clone(S.config), isHost: !!isHost, now: Date.now() };
  }

  const api = { KEYS, TEAMS, DEFAULT_CONFIG, DEFAULT_BOSSES, create, host, act, login, snapshot, randomStats, defaultStats, checkConfig, checkBosses, checkRoster };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RaidSimEngine = api;
})(typeof window !== "undefined" ? window : this);
