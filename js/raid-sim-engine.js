// 보스 레이드 시뮬레이터의 규칙과 진행 상태 (스탯 판정, AI 없음).
// 관리 화면 미리보기(admin.html?demo=1)의 보스 레이드 탭에서 브라우저가 직접 씁니다. Supabase 판정은 supabase/raid-sim.sql (규칙이 같아야 합니다).
//   캐릭터 스탯 5개: 체력 · 지력 · 친화력 · 멘탈 · 운
//   공격력 = 판정 스탯 합 (+돌발 이벤트 주사위). 보스 HP 이상이면 격파 → 보상 점수.
//   돌발 이벤트 룰렛: 진행자가 정한 칸(config.roulette, 2~10칸) 중 하나. 칸 효과 kind: power(공격력 ±value) · clear(격파하면 +value점) · fail(실패해도 +value점) · none
//   운: 운이 높을수록 아래쪽 칸이 잘 나옵니다. k번째 칸의 가중치 = r^(k-1), r = (1 + luckPower/100)^t, t = (운 − 스탯 최소) / (스탯 최대 − 스탯 최소).
//   연습 라운드: 0번 라운드(config.practiceBoss). 룰렛은 항상 터지고, 출전 기록과 점수에는 들어가지 않습니다.
//   라운드 공격력 1위 조는 MVP 점수. 순위는 총점, 같으면 공격력 합.
(function (root) {
  "use strict";

  const KEYS = ["hp", "intel", "social", "mental", "luck"];
  const TEAMS = ["A조", "B조"];   // 명단이 없을 때 (6자리 연습판)
  const DEFAULT_NAMES = ["참여자 1", "참여자 2", "참여자 3", "참여자 4", "참여자 5", "참여자 6"];
  const SEATS = DEFAULT_NAMES.length;
  const DEFAULT_CONFIG = { statTotal: 25, statMin: 1, statMax: 10, rerolls: 2, meetingSec: 180, shareMin: 8, mvpBonus: 1, luckPower: 35,
    roulette: [{ kind: "power", value: -2 }, { kind: "power", value: -1 }, { kind: "power", value: 1 }, { kind: "clear", value: 1 }, { kind: "fail", value: 1 }, { kind: "power", value: 3 }],
    practiceBoss: { name: "연습 보스: 월요일 아침 '만원 지하철'", desc: "월요일 아침 8시, 지하철 문이 열리자 사람들이 밀려든다. 손잡이 하나 잡기도 힘든 이 전쟁을 버텨야 회사에 도착한다. 연습 판이니 부담 없이 붙어 보자!",
      hp: 10, stats: ["hp", "luck"], hint: "버티거나, 운 좋게 앉거나.", reveal: "만원 지하철을 이긴 건 끝까지 서서 버티는 체력, 그리고 마침 앞자리가 비는 운이었습니다. 머리를 써도 지하철은 빨리 오지 않아요." },
    // 첫 화면 · 규칙 화면 문구 (비어 있으면 기본 문구)
    lobbyTitle: "", lobbySub: "", rulesTitle: "", rulesLines: [] };
  const SPIN_KINDS = ["power", "clear", "fail", "none"];
  // stats · hint · reveal 은 결과 공개 전까지 참여자에게 보내지 않습니다 (snapshot 참고).
  const DEFAULT_BOSSES = [
    {"name":"무한 회의 루프 '리:미팅'","desc":"회의가 끝나면 '방금 회의를 정리하는 회의'가 소환된다. 벌써 세 번째 회의, 의자는 딱딱하고 결론은 또 다음 회의로 미뤄진다. 이 보스는 쓰러뜨리는 게 아니라 끝날 때까지 버텨야 사라진다.","hp":11,"reward":1,"event":false,"diceLow":-2,"diceHigh":3,"stats":["hp","mental"],"hint":"끝까지 남는 사람이 이긴다.","reveal":"끝없는 회의를 이긴 건 말솜씨가 아니라 버티는 힘이었습니다. 몇 시간째 이어지는 회의를 견딜 체력, 결론 없는 말들에 지치지 않을 멘탈이 필요했어요. 지력으로 정리해 보려 해도 회의는 또 다른 회의를 낳을 뿐이었습니다."},
    {"name":"알림 폭탄 '안읽음 999+'","desc":"점심 먹고 왔더니 단톡방 9개에 안 읽은 메시지가 999개. 그 사이 어딘가에 팀장님의 \"이거 확인 가능?\"이 숨어 있다. 하나씩 다 읽다가는 퇴근 시간이 지나 버린다.","hp":12,"reward":2,"event":false,"diceLow":-2,"diceHigh":3,"stats":["intel","mental"],"hint":"999개를 다 읽을 필요는 없다.","reveal":"999개를 다 읽는 사람이 아니라 중요한 한 개를 골라내는 사람이 이겼습니다. 쏟아지는 알림 속에서 우선순위를 가려낼 지력, 빨간 숫자에 흔들리지 않을 멘탈이 핵심이었어요. 체력으로 하나하나 다 읽으면 오히려 늦었습니다."},
    {"name":"팀장님의 '편하게 얘기해 봐요'","desc":"회의 끝 무렵, 팀장님이 웃으며 말한다. \"부담 갖지 말고 편하게 얘기해 봐요.\" 회의실에 정적이 흐르고 모두의 시선이 바닥으로 향한다. 침묵도 정답이 아니고, 아무 말이나 꺼내도 정답이 아니다.","hp":12,"reward":2,"event":false,"diceLow":-2,"diceHigh":3,"stats":["intel","social"],"hint":"아무 말도 안 하면 지고, 아무 말이나 해도 진다.","reveal":"할 말을 빠르게 정리하는 지력과, 그 말을 분위기에 맞게 꺼내는 친화력이 함께 필요했습니다. 정리만 하고 말을 못 꺼내면 침묵이 되고, 분위기만 읽고 내용이 없으면 공허한 말이 됐어요."},
    {"name":"금요일 17:58 '긴급 수정 요청'","desc":"퇴근 2분 전 도착한 메일. 제목: [긴급] 최종_진짜최종_수정본 확인 부탁드립니다. 첨부 파일은 세 개, 수정 요청은 스무 군데. 금요일 저녁에는 무슨 일이 생길지 아무도 모른다.","hp":13,"reward":3,"event":true,"diceLow":-2,"diceHigh":3,"stats":["social","hp"],"hint":"혼자 하면 밤 10시, 같이 하면 7시.","reveal":"혼자 밤새 붙잡고 있기보다 동료를 불러 일을 나누는 게 정답이었습니다. 도움을 청하고 함께 움직일 친화력, 마지막 수정까지 밀어붙일 체력이 필요했어요. 금요일 저녁의 변수는 주사위가 정했습니다."},
    {"name":"최종 보스: 연말 회식 '건배사 지명'","desc":"1차, 2차, 노래방까지 이어진 연말 회식. 자정 무렵 마이크가 나에게 넘어온다. \"자, 올해 마무리 한마디!\" 수십 명의 눈이 나만 보고 있고, 분위기는 이미 무르익었다.","hp":16,"reward":4,"event":true,"diceLow":-2,"diceHigh":3,"stats":["hp","social","mental"],"hint":"이 자리에서 머리를 쓰는 사람은 없다.","reveal":"자정까지 버틸 체력, 분위기를 읽고 사람들을 웃길 친화력, 수십 명 앞에서도 떨지 않을 멘탈이 모두 필요했습니다. 이 자리에서 머리를 굴리는 사람은 없었어요. 지력만 빠진 이유입니다."},
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
  // 돌발 이벤트 룰렛: 운이 높을수록 아래쪽 칸 쪽으로 기울어짐. 1부터 시작하는 칸 번호를 돌려줌
  function luckWeights(cfg, luck) {
    const span = cfg.statMax - cfg.statMin, n = (cfg.roulette || []).length;
    const t = span > 0 ? Math.min(1, Math.max(0, ((Number(luck) || 0) - cfg.statMin) / span)) : 0;
    const r = Math.pow(1 + (cfg.luckPower || 0) / 100, t);
    return Array.from({ length: n }, (_, k) => Math.pow(r, k));
  }
  function rollSpin(cfg, luck) {
    const w = luckWeights(cfg, luck), total = w.reduce((a, b) => a + b, 0);
    let u = Math.random() * total;
    for (let k = 0; k < w.length; k++) { u -= w[k]; if (u < 0) return k + 1; }
    return w.length;
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
    if (!isInt(c.luckPower, 0, 100)) return "운 효과 세기는 0~100이에요 (0이면 운과 상관없이 모든 칸이 같은 확률)";
    for (const k of ["lobbyTitle", "lobbySub", "rulesTitle"]) if (typeof c[k] !== "string" || c[k].length > 200) return "화면 문구는 200자 이하예요";
    if (!Array.isArray(c.rulesLines) || c.rulesLines.length > 12 || c.rulesLines.some((x) => typeof x !== "string" || x.length > 200)) return "규칙 줄은 12줄, 한 줄 200자까지예요";
    if (!Array.isArray(c.roulette) || c.roulette.length < 2 || c.roulette.length > 10) return "룰렛 칸은 2~10개예요";
    if (c.roulette.some((x) => !x || typeof x !== "object" || !SPIN_KINDS.includes(x.kind) || !isInt(x.value, -50, 50))) return "룰렛 칸의 효과 값은 -50~50이에요";
    return checkBoss(Object.assign({ reward: 0, event: true, diceLow: 0, diceHigh: 0 }, c.practiceBoss), "연습 보스: ");
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
  function checkBoss(b, pre) {
      if (!b || typeof b !== "object") return pre + "형식이 잘못됐어요";
      if (typeof b.name !== "string" || !b.name.trim() || b.name.length > 60) return pre + "이름은 1~60자로 적어 주세요";
      if (typeof b.desc !== "string" || b.desc.length > 300) return pre + "설명은 300자 이하예요";
      if (!isInt(b.hp, 1, 300)) return pre + "HP는 1~300이에요";
      if (!isInt(b.reward, 0, 50)) return pre + "보상 점수는 0~50점이에요";
      if (typeof b.event !== "boolean") return pre + "돌발 이벤트 값이 잘못됐어요";
      if (!isInt(b.diceLow, -50, 50) || !isInt(b.diceHigh, -50, 50)) return pre + "주사위 효과는 -50~50이에요";
      if (!Array.isArray(b.stats) || b.stats.length < 1 || b.stats.length > KEYS.length || b.stats.some((s, j) => !KEYS.includes(s) || b.stats.indexOf(s) !== j)) return pre + "판정 스탯을 1개 이상 골라 주세요";
      if (typeof b.hint !== "string" || b.hint.length > 200) return pre + "힌트는 200자 이하예요";
      if (typeof b.reveal !== "string" || b.reveal.length > 300) return pre + "공개 설명은 300자 이하예요";
      return null;
  }
  function checkBosses(list) {
    if (!Array.isArray(list) || list.length < 1 || list.length > 20) return "보스는 1~20명이어야 해요";
    for (let i = 0; i < list.length; i++) { const e = checkBoss(list[i], i + 1 + "번 보스: "); if (e) return e; }
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
  // 명단 판에서는 아이디로 입장한 사람만 출전 후보 (6자리 연습판은 모두)
  const present = (S, p) => S.mode !== "roster" || !!(p && p.claimed);
  const canPick = (S, pid, t) => present(S, S.people[pid]) &&
    (!played(S, pid, S.game.round) || teamOf(S, t).filter((m) => present(S, m)).every((m) => played(S, m.id, S.game.round)));
  const charOf = (S, p) => p.char || Object.assign(defaultStats(S.config), { seed: p.seed || 1, isDefault: true });
  // 0번 라운드 = 연습 보스 (룰렛 항상, 보상 없음)
  const bossAt = (S, r) => r === 0 ? Object.assign({ reward: 0, event: true, diceLow: 0, diceHigh: 0 }, S.config.practiceBoss) : S.bosses[r - 1];
  const editable = (g) => !g.locked && (g.stage === "make" || g.stage === "share");

  function lockCharacters(S) {
    personList(S).forEach((p) => { if (!p.char) p.char = charOf(S, p); });
  }
  function clearPicksFrom(S, r) {
    Object.keys(S.picks).forEach((key) => { const m = key.match(/^r(\d+)t\d+$/); if (m && Number(m[1]) >= r) delete S.picks[key]; });
  }
  function closeRound(S) {
    const g = S.game, r = g.round, b = bossAt(S, r), cfg = S.config;
    for (let t = 0; t < S.teams.length; t++) {
      if (pickOf(S, r, t)) continue;
      // 아무도 안 골랐으면: 아직 안 나간 사람 → 입장한 사람을 먼저, 그 안에서 랜덤
      const all = teamOf(S, t), rank = (m) => (played(S, m.id, r) ? 2 : 0) + (present(S, m) ? 0 : 1);
      const best = Math.min(...all.map(rank)), list = all.filter((m) => rank(m) === best);
      S.picks["r" + r + "t" + t] = { pid: list[rand(list.length)].id, by: null, auto: true };
    }
    const rows = S.teams.map((_, t) => {
      const k = pickOf(S, r, t), p = S.people[k.pid], c = charOf(S, p);
      const base = b.stats.reduce((n, s) => n + (c[s] || 0), 0);
      // 돌발 이벤트: 운으로 기울어진 룰렛 (dice = 나온 칸 번호, effect = 그 칸의 효과)
      let dice = null, bonus = 0, rolls = null, effect = null;
      if (b.event) { dice = rollSpin(cfg, c.luck); rolls = [dice]; effect = clone(cfg.roulette[dice - 1]); bonus = effect.kind === "power" ? effect.value : 0; }
      const power = base + bonus, cleared = power >= b.hp;
      const extra = effect && ((effect.kind === "clear" && cleared) || (effect.kind === "fail" && !cleared)) ? effect.value : 0;
      return { team: t, pid: p.id, name: p.name, base, dice, rolls, effect, bonus, power, cleared, extra, auto: !!k.auto };
    });
    const max = Math.max(...rows.map((x) => x.power));
    rows.forEach((x) => { x.mvp = x.power === max; x.points = (x.cleared ? b.reward : 0) + (x.mvp ? cfg.mvpBonus : 0) + x.extra; });
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
      const ok = g.stage === "boss" && Number.isInteger(r) && r >= 0 && r <= S.bosses.length &&
        (((r === 0 || r === 1) && (g.phase === "idle" || !g.round)) || (r === g.round && (g.phase === "closed" || g.phase === "rolled")) || (r === g.round + 1 && g.phase === "revealed"));
      if (!ok) return r === 0 ? "연습은 본게임 전에만 할 수 있어요" : "지금은 " + r + "번 보스를 시작할 수 없어요";
      lockCharacters(S);
      clearPicksFrom(S, r);
      Object.keys(g.results).forEach((k) => { if (Number(k) >= r) delete g.results[k]; });
      Object.assign(g, { round: r, phase: "meeting", hint: false, locked: true, deadline: Date.now() + S.config.meetingSec * 1000 });
    },
    hint(S) { if (S.game.phase !== "meeting") return "회의 중에만 힌트를 열 수 있어요"; S.game.hint = true; },
    close(S) { if (S.game.phase !== "meeting") return "회의 중에만 마감할 수 있어요"; closeRound(S); },
    roll(S) {
      const g = S.game, b = bossAt(S, g.round);
      if (g.phase !== "closed") return "마감한 뒤에 룰렛을 돌릴 수 있어요";
      if (!b || !b.event) return "이번 보스는 돌발 이벤트가 없어요";
      Object.assign(g, { phase: "rolled", rollAt: Date.now() });
    },
    reveal(S) {
      const g = S.game, b = bossAt(S, g.round);
      if (g.phase === "closed" && b && b.event) return "돌발 이벤트 라운드예요. 먼저 \"룰렛 돌리기\"를 눌러 주세요";
      if (g.phase !== "closed" && g.phase !== "rolled") return "마감한 뒤에 공개할 수 있어요";
      g.phase = "revealed";
    },
    final(S) { if (S.game.phase !== "revealed") return "결과 공개 뒤에 최종 순위를 띄울 수 있어요"; S.game.phase = "final"; },
    // 한 단계 전으로 (supabase/raid-sim.sql 의 'back' 과 같음)
    back(S) {
      const g = S.game, r = g.round, roundOf = (key) => Number((key.match(/^r(\d+)t\d+$/) || [])[1]);
      if (g.stage === "lobby") return "더 이전 단계가 없어요";
      if (g.stage === "make") { g.stage = "lobby"; return; }
      if (g.stage === "share") { Object.assign(g, { stage: "make", shareDeadline: null }); return; }
      if (g.phase === "idle") { Object.assign(g, { stage: "share", locked: false, shareDeadline: Date.now() + S.config.shareMin * 60000 }); return; }
      if (g.phase === "meeting") {
        Object.keys(S.picks).forEach((k) => { if (roundOf(k) >= r) delete S.picks[k]; });
        Object.keys(g.results).forEach((k) => { if (Number(k) >= r) delete g.results[k]; });
        if (r === 0 || !g.results[r - 1]) Object.assign(g, { round: 0, phase: "idle", hint: false, deadline: null });
        else Object.assign(g, { round: r - 1, phase: "revealed", hint: false, deadline: null });
        return;
      }
      if (g.phase === "closed") {
        Object.keys(S.picks).forEach((k) => { if (roundOf(k) === r && S.picks[k].auto) delete S.picks[k]; });
        delete g.results[r];
        Object.assign(g, { phase: "meeting", deadline: Date.now() + S.config.meetingSec * 1000 });
        return;
      }
      if (g.phase === "rolled") { Object.assign(g, { phase: "closed", rollAt: null }); return; }
      if (g.phase === "revealed") { const b = bossAt(S, r); g.phase = b && b.event ? "rolled" : "closed"; return; }
      if (g.phase === "final") { g.phase = "revealed"; return; }
      return "돌아갈 수 없어요";
    },
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
      if (g && g.round === 0 && ["meeting", "closed", "rolled"].includes(g.phase) && JSON.stringify(next.practiceBoss) !== JSON.stringify(S.config.practiceBoss)) return "연습 라운드 진행 중에는 연습 보스를 바꿀 수 없어요";
      // 저장할 때는 아는 칸만 남김
      next.roulette = next.roulette.map((x) => ({ kind: x.kind, value: x.value }));
      const p = next.practiceBoss;
      next.practiceBoss = { name: p.name.trim(), desc: p.desc, hp: p.hp, stats: p.stats.slice(), hint: p.hint, reveal: p.reveal };
      next.rulesLines = next.rulesLines.map((x) => x.trim()).filter(Boolean);
      S.config = clone(next);
    },
    saveBosses(S, _, data) {
      const g = S.game;
      if (g && (g.phase === "meeting" || g.phase === "closed" || g.phase === "rolled")) return "라운드 진행 중(회의·마감)에는 보스를 바꿀 수 없어요. 결과 공개 뒤에 저장해 주세요";
      const err = checkBosses(data);
      if (err) return err;
      if (g && g.stage === "boss" && data.length < g.round) return "이미 진행한 " + g.round + "라운드보다 보스 수를 줄일 수 없어요";
      S.bosses = data.map((b) => ({ name: b.name.trim(), desc: b.desc, hp: b.hp, reward: b.reward, event: b.event, diceLow: b.diceLow, diceHigh: b.diceHigh, stats: b.stats.slice(), hint: b.hint, reveal: b.reveal }));
    },
    resetBosses(S) {
      const g = S.game;
      if (g && (g.phase === "meeting" || g.phase === "closed" || g.phase === "rolled")) return "라운드 진행 중(회의·마감)에는 보스를 바꿀 수 없어요";
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
      if (!present(S, m)) return "아직 입장하지 않은 사람이에요. 아이디로 입장한 사람만 고를 수 있어요";
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
    const pb = bossAt(S, 0);
    const practice = { name: pb.name, desc: pb.desc, hp: pb.hp, reward: 0, event: true, nStats: pb.stats.length };
    if (isHost || open(0)) Object.assign(practice, { stats: pb.stats.slice(), hint: pb.hint, reveal: pb.reveal });
    else if (g && g.hint && g.round === 0) practice.hint = pb.hint;
    if (g && !isHost) {
      Object.keys(g.results || {}).forEach((k) => {
        const rolled = Number(k) === g.round && g.phase === "rolled";
        if (!open(Number(k))) g.results[k] = g.results[k].map((x) => Object.assign({ team: x.team, pid: x.pid, name: x.name, auto: x.auto }, rolled ? { dice: x.dice, rolls: x.rolls, bonus: x.bonus, effect: x.effect } : {}));
      });
    }
    const people = clone(S.people);
    if (!isHost) Object.values(people).forEach((p) => { delete p.uid; });   // 참여자 화면에는 아이디를 보내지 않음
    const config = clone(S.config);
    if (!isHost) delete config.practiceBoss;   // 연습 보스의 판정 스탯은 진행자에게만
    return { game: g, people, picks: clone(S.picks), teams: S.teams.slice(), mode: S.mode, bosses, practice, config, isHost: !!isHost, now: Date.now() };
  }

  const api = { luckWeights, rollSpin, KEYS, TEAMS, DEFAULT_CONFIG, DEFAULT_BOSSES, create, host, act, login, snapshot, randomStats, defaultStats, checkConfig, checkBosses, checkRoster };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RaidSimEngine = api;
})(typeof window !== "undefined" ? window : this);
