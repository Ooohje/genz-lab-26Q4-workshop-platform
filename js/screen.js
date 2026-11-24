// screen: 프로젝터에 띄우는 워드클라우드 (1920×1080 기준으로 만들고 창 크기에 맞춰 통째로 확대·축소)
(function () {
  const { getSession, getWords, aggregate, subscribe, joinUrl, qrSvg, toast } = window.WC;
  const W = 1920, H = 1080;
  const FONT = "Pretendard Variable";
  const MIN_FONT = 24; // 프로젝터에서 읽을 수 있는 가장 작은 글자 크기
  const $ = (id) => document.getElementById(id);
  const stage = $("stage");
  const cloudEl = $("cloud");

  // ── 창 크기에 맞추기 ─────────────────────────────────────────────
  let stageScale = 1;
  function fit() {
    stageScale = Math.min(innerWidth / W, innerHeight / H);
    const x = (innerWidth - W * stageScale) / 2;
    const y = (innerHeight - H * stageScale) / 2;
    stage.style.transform = "translate(" + x + "px," + y + "px) scale(" + stageScale + ")";
  }
  addEventListener("resize", fit);
  fit();

  // ── QR과 접속 주소 ───────────────────────────────────────────────
  const url = joinUrl();
  document.querySelectorAll("[data-qr]").forEach((el) => (el.innerHTML = qrSvg(url)));
  document.querySelectorAll("[data-addr]").forEach(
    (el) => (el.textContent = url.replace(/^https?:\/\//, "").replace(/\/$/, "")),
  );

  // ── 상태 ────────────────────────────────────────────────────────
  let session = null;
  let rows = [];            // 숨기지 않은 words 줄
  const seen = new Set();   // 이미 받은 줄 id (중복 방지)
  let view = "orig";        // orig | ai
  let lastAiAt = null;
  let layoutTimer = null;
  let layoutRun = 0;
  let lastSig = "";
  let loadingSince = 0;
  const fitScale = {}; // 보기(orig/ai)별로 마지막에 맞았던 글자 배율

  // ── 색: 단어가 놓인 자리의 배경색에 맞춰 고릅니다 ───────────────────
  const near = (x, y, cx, cy, r) => (x - cx) * (x - cx) + (y - cy) * (y - cy) < r * r;
  function regionAt(x, y) {
    if (near(x, y, 1450, 790, 380)) return "coral";
    if (near(x, y, 1520, 260, 330)) return "purple";
    if (near(x, y, 650, 380, 380) || near(x, y, 430, 900, 330)) return "blue";
    return "pale";
  }
  const PALETTES = {
    blue: ["#FFFFFF", "#1F2540", "#FFFFFF", "#FFD9CC"],
    coral: ["#FFFFFF", "#1F2540", "#4B2E9E", "#FFFFFF"],
    purple: ["#FFFFFF", "#1F2540", "#FFFFFF", "#FFE3DA"],
    pale: ["#1F2540", "#DD4A2C", "#3553B8", "#6A3FBF"],
  };
  const LIGHT = new Set(["#FFFFFF", "#FFD9CC", "#FFE3DA"]);
  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  // ── 글자 크기: 많이 나온 단어일수록 크고 굵게. 단어 종류가 많아지면 전체를 줄입니다 ──
  function sized(items) {
    const n = items.length;
    const max = Math.max(...items.map((d) => d.count));
    const t = Math.min(1, Math.max(0, (n - 8) / 52));
    const maxS = 110 - 20 * t;
    const minS = 44 - 22 * t;
    return items.map((d) => {
      const ratio = max > 1 ? (d.count - 1) / (max - 1) : 0.35;
      const size = minS + (maxS - minS) * Math.pow(ratio, 0.7);
      const weight = ratio >= 0.5 ? 800 : ratio >= 0.25 ? 700 : ratio > 0.08 ? 600 : 500;
      return { key: d.key, text: d.text, count: d.count, base: size, weight };
    });
  }

  // 클라우드가 피해야 할 자리(질문, 인원, QR, AI 버튼) — 실제 위치를 재서 씁니다.
  function blockedRects() {
    const s = stage.getBoundingClientRect();
    return ["head", "stats", "qr", "mascot", "ai"]
      .map((id) => $(id))
      .filter((el) => el && !el.hidden)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const m = 18;
        return [
          (r.left - s.left) / stageScale - m, (r.top - s.top) / stageScale - m,
          (r.right - s.left) / stageScale + m, (r.bottom - s.top) / stageScale + m,
        ];
      });
  }
  const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

  // 줄 높이 1인 글자 상자에서 기준선이 위에서 몇 % 지점에 있는지 (글꼴에서 직접 잽니다)
  let baseCache = 0;
  function baselineRatio() {
    if (baseCache) return baseCache;
    let ratio = 0.845; // Pretendard 기준 근삿값 (측정이 안 될 때)
    try {
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.font = '700 100px "' + FONT + '"';
      const m = ctx.measureText("가Ag");
      const asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
      if (asc > 0 && desc >= 0) ratio = ((100 - (asc + desc)) / 2 + asc) / 100;
    } catch (e) { /* 근삿값 사용 */ }
    if (document.fonts.check('700 100px "' + FONT + '"', "가")) baseCache = ratio;
    return ratio;
  }

  function runCloud(items, scale, size) {
    return new Promise((resolve) => {
      window.d3.layout.cloud()
        .size(size)
        .words(items.map((d) => ({ key: d.key, text: d.text, count: d.count, weight: d.weight, size: Math.max(MIN_FONT, Math.round(d.base * scale)) })))
        .padding((d) => 8 + d.size * 0.08) // 둥실 떠다니는 폭(7px)보다 넉넉하게
        .rotate(0)
        .font(FONT)
        .fontWeight((d) => d.weight)
        .fontSize((d) => d.size)
        .random(() => 0.5) // 항상 중앙에서 시작 → 큰 단어가 가운데, 같은 입력이면 같은 배치
        .on("end", resolve)
        .start();
    });
  }

  async function layout() {
    const run = ++layoutRun;
    const source = view === "ai" && session.ai_groups
      ? session.ai_groups.map((g) => ({ key: "ai:" + g.label, text: g.label, count: g.count }))
      : aggregate(rows).items.filter((d) => !d.hidden);

    renderChrome(source.length);
    if (!source.length) return draw([]);

    const items = sized(source);
    try {
      await Promise.race([
        document.fonts.load('700 40px "' + FONT + '"', items.map((d) => d.text).join("")),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
    } catch (e) { /* 글꼴을 못 받아도 계속 */ }
    if (run !== layoutRun) return;

    const blocked = blockedRects();
    const top = Math.max(...blocked.filter((b) => b[1] < 300).map((b) => b[3]), 60);
    // 위로는 질문·인원 아래부터, 아래로는 QR 카드 위까지의 넓은 띠를 씁니다.
    const bottom = Math.min(...blocked.filter((b) => b[3] > 900 && b[2] > W / 2).map((b) => b[1]), H - 40);
    const size = [W - 112, bottom - top];
    const cx = W / 2, cy = top + size[1] / 2;

    let placed = [];
    // 화면을 넉넉히 채우도록 큰 배율부터 시도하고, 다 들어가지 않거나 QR·질문과 겹치면 조금씩 줄입니다.
    const LAST = 13;
    // 직전에 맞았던 배율 바로 위에서 시작해 계산을 줄입니다(단어가 하나 늘 때마다 처음부터 찾지 않도록).
    const startScale = fitScale[view] ? Math.min(1.8, fitScale[view] / 0.9) : 1.8;
    const t0 = performance.now();
    for (let scale = startScale, tries = 0; tries <= LAST; tries++, scale *= 0.9) {
      const out = await runCloud(items, scale, size);
      if (run !== layoutRun) return;
      const base = baselineRatio();
      placed = out.map((d) => {
        // d3-cloud의 y는 글자의 기준선(baseline)입니다. 화면 요소는 가운데 기준으로 놓으므로
        // 기준선이 정확히 그 자리에 오도록 글자 크기에 비례해 올려 줍니다. (안 하면 큰 글자일수록 아래로 밀려 겹칩니다)
        const x = cx + d.x;
        const y = cy + d.y + (0.5 - base) * d.size;
        const half = (d.x1 - d.x0) / 2;
        const box = [x - half, cy + d.y - 0.9 * d.size, x + half, cy + d.y + 0.3 * d.size];
        return { key: d.key, text: d.text, count: d.count, weight: d.weight, size: d.size, x, y, box };
      });
      const clash = placed.some((p) => blocked.some((b) => hit(p.box, b)));
      if (out.length === items.length && !clash) {
        fitScale[view] = scale;
        break;
      }
      if (tries === LAST) placed = placed.filter((p) => !blocked.some((b) => hit(p.box, b)));
    }
    window.__layoutMs = Math.round(performance.now() - t0);
    draw(placed);
  }

  // ── 그리기: 새 단어는 떠오르며 나타나고, 횟수가 늘면 커지며 살짝 튕깁니다 ──
  const nodes = new Map();
  function draw(placed) {
    const keep = new Set(placed.map((p) => p.key));
    for (const [key, n] of nodes) {
      if (keep.has(key)) continue;
      n.el.classList.add("leave");
      nodes.delete(key);
      setTimeout(() => n.el.remove(), 900);
    }
    placed.forEach((p) => {
      let n = nodes.get(p.key);
      const isNew = !n;
      if (isNew) {
        const el = document.createElement("div");
        el.className = "word enter";
        const float = document.createElement("span");
        float.className = "float";
        const h = hash(p.key);
        float.style.animationDuration = 7 + (h % 5) * 1.3 + "s";
        float.style.animationDelay = -((h % 90) / 10) + "s";
        const pop = document.createElement("span");
        pop.className = "pop";
        pop.textContent = p.text;
        float.appendChild(pop);
        el.appendChild(float);
        cloudEl.appendChild(el);
        n = { el, pop, count: p.count };
        nodes.set(p.key, n);
      }
      const pal = PALETTES[regionAt(p.x, p.y)];
      const color = pal[(hash(p.key) + p.count) % pal.length];
      const s = n.el.style;
      s.transform = "translate(" + p.x.toFixed(1) + "px," + p.y.toFixed(1) + "px) translate(-50%,-50%)";
      s.fontSize = p.size + "px";
      s.fontWeight = p.weight;
      s.color = color;
      s.opacity = p.count === 1 && placed.length > 20 ? 0.9 : 1;
      s.textShadow = LIGHT.has(color) ? "0 2px 18px rgba(31,37,64,0.22)" : "0 1px 12px rgba(255,255,255,0.25)";
      if (isNew) {
        // 처음 위치를 잡은 다음 프레임에 떠오르게
        requestAnimationFrame(() => requestAnimationFrame(() => n.el.classList.remove("enter")));
      } else if (p.count > n.count) {
        n.pop.classList.remove("bounce");
        void n.pop.offsetWidth;
        n.pop.classList.add("bounce");
      }
      n.count = p.count;
    });
  }

  // ── 주변 요소(질문, 인원, QR, AI 버튼) ───────────────────────────
  function renderChrome(shown) {
    const agg = aggregate(rows);
    $("question").textContent = session.question;
    $("people").textContent = agg.people;
    $("total").textContent = agg.total;

    // '생각을 모으는 중'은 최대 70초만 보여 줍니다(서버가 중간에 멈춰도 화면이 갇히지 않게).
    if (session.ai_status !== "loading") loadingSince = 0;
    else if (!loadingSince) {
      loadingSince = Date.now();
      setTimeout(() => schedule(0), 71000);
    }
    const loading = session.ai_status === "loading" && Date.now() - loadingSince < 70000;
    const empty = agg.total === 0;
    $("wait").hidden = !empty;
    $("qr").hidden = empty;
    $("mascot").hidden = empty;
    $("loading").hidden = !loading;
    cloudEl.classList.toggle("dim", loading);

    const ai = view === "ai";
    $("ai").classList.toggle("open", ai);
    $("ai-info").hidden = !ai;
    $("ai-label").textContent = loading ? "요약하는 중" : ai ? "원본 보기" : "AI 요약";
    $("ai-btn").disabled = loading;
    $("ai").style.opacity = empty ? 0.6 : 1;
    if (ai) {
      const kinds = agg.items.filter((d) => !d.hidden).length;
      $("ai-line").textContent = "AI가 비슷한 표현을 묶었어요 · 표현 " + kinds + "개 → 단어 " + shown + "개";
    }
  }

  function schedule(delay) {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => layout().catch(console.error), delay == null ? 350 : delay);
  }

  function setView(next) {
    if (view === next) return;
    view = next;
    schedule(0);
  }

  $("ai-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    if (view === "ai") return setView("orig");
    if (session && session.ai_groups && session.ai_groups.length) return setView("ai");
    toast("관리 화면에서 'AI 정리 실행'을 눌러 주세요");
  });
  stage.addEventListener("click", () => { if (view === "ai") setView("orig"); });

  // 보스 레이드 중에는 워드클라우드 대신 보스 레이드 화면(js/raid.js)을 보여 줍니다. 같은 페이지라 BGM도 이어집니다.
  let raidMounted = false;
  function showRaid(s) {
    const on = !!s && s.program === "raid";
    document.getElementById("stage").hidden = on;
    document.getElementById("raid-screen").hidden = !on;
    if (on && !raidMounted && window.WCRaid) { window.WCRaid.mountScreen(document.getElementById("raid-screen")); raidMounted = true; }
  }

  function applySession(next) {
    showRaid(next);
    const prev = session;
    session = next;
    if (prev && next.rev !== prev.rev) return resync(); // 숨기기·초기화 → 단어를 다시 읽기
    const fresh = next.ai_status === "done" && next.ai_updated_at && next.ai_updated_at !== lastAiAt;
    if (fresh) {
      lastAiAt = next.ai_updated_at;
      view = "ai"; // 새 AI 정리 결과가 오면 자동으로 보여 줍니다
    }
    if (!next.ai_groups) view = "orig";
    schedule(0);
  }

  async function resync() {
    const [s, all] = await Promise.all([getSession(), getWords(session.id)]);
    // 달라진 것이 없으면 다시 그리지 않습니다.
    const sig = JSON.stringify([s, all.length, all.filter((r) => r.hidden).length, all.length ? all[all.length - 1].id : 0]);
    if (sig === lastSig) return;
    lastSig = sig;
    rows = all.filter((r) => !r.hidden);
    seen.clear();
    all.forEach((r) => seen.add(r.id));
    if (s) {
      const fresh = s.ai_status === "done" && s.ai_updated_at && s.ai_updated_at !== lastAiAt;
      if (fresh && lastAiAt !== undefined) { lastAiAt = s.ai_updated_at; view = "ai"; }
      session = s;
      if (!s.ai_groups) view = "orig";
    }
    schedule(0);
  }

  async function start() {
    try {
      session = await getSession();
    } catch (e) {
      session = null;
    }
    if (!session) {
      $("msg").hidden = false;
      $("msg").textContent = "세션을 불러오지 못했어요. config.js와 접속 코드를 확인해 주세요.";
      return;
    }
    showRaid(session);
    lastAiAt = session.ai_updated_at; // 이미 있던 결과는 자동으로 띄우지 않고 버튼으로 봅니다
    // screen.html?view=ai 로 열면 AI 정리 결과부터 보여 줍니다.
    if (new URLSearchParams(location.search).get("view") === "ai" && session.ai_groups) view = "ai";
    await resync();
    subscribe(session.id, {
      onWord: (r) => {
        if (seen.has(r.id)) return;
        seen.add(r.id);
        if (!r.hidden) rows.push(r);
        schedule();
      },
      onSession: applySession,
      onStatus: (status) => { if (status === "SUBSCRIBED") resync().catch(console.error); },
    });
    // 실시간 연결이 잠깐 끊겨도 놓친 단어가 없도록 20초마다 맞춰 봅니다.
    setInterval(() => resync().catch(() => {}), 20000);
  }

  start();
})();
