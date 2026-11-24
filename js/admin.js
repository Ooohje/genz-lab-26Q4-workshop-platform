// admin: 진행자 관리 화면. 모든 변경은 Edge Function(admin)을 거칩니다.
(function () {
  const { cfg, code, getSession, getWords, aggregate, subscribe, toast } = window.WC;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const DEMO = params.get("demo") === "1"; // 서버 없이 화면만 보는 미리보기 (README 스크린샷용)

  let password = null; // 메모리에만 보관. 새로고침하면 다시 입력합니다.
  let session = null;
  let rows = [];
  let busy = false;
  let qDirty = false;
  let aiRunning = false;
  const PLATFORM = window.WCAdminPlatform;

  // ── Edge Function 호출 ───────────────────────────────────────────
  async function api(action, extra) {
    if (DEMO) return demoApi(action, extra);
    const res = await fetch(cfg.supabaseUrl + "/functions/v1/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.supabaseKey },
      body: JSON.stringify(Object.assign({ password, code, action }, extra)),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || "요청에 실패했어요 (" + res.status + ")");
    return data;
  }

  // ── 로그인 ──────────────────────────────────────────────────────
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("login-btn");
    btn.disabled = true;
    btn.textContent = "확인하는 중…";
    $("login-err").hidden = true;
    password = $("pw").value;
    try {
      const out = await api("verify");
      session = out.session;
      $("pw").value = "";
      await enter();
    } catch (err) {
      password = null;
      $("login-err").textContent = err.message;
      $("login-err").hidden = false;
    }
    btn.disabled = false;
    btn.textContent = "들어가기";
  });

  async function enter() {
    $("login").hidden = true;
    $("panel").hidden = false;
    const suffix = params.get("s") ? "?s=" + encodeURIComponent(params.get("s")) : "";
    $("link-screen").href = "screen.html" + suffix;
    $("link-join").href = "./" + suffix;
    await resync();
    // 메인 관제·명단·석식 탭(js/admin-platform.js)에 연결
    PLATFORM.entered({
      api, demo: DEMO, toast,
      getSession: () => session,
      setSession: (s) => { session = s; render(); },
    });
    // 보스 레이드 탭 · 레이드 설정 탭 (js/raid.js): 이 화면의 관리자 비밀번호를 그대로 씁니다
    if (window.WCRaid) window.WCRaid.mountAdmin({ host: $("raid-host"), settings: $("raid-settings"), password: () => password, demo: DEMO });
    if (DEMO) return;
    subscribe(session.id, {
      onWord: (r) => {
        if (rows.some((x) => x.id === r.id)) return;
        rows.push(r);
        renderList();
      },
      onSession: (s) => {
        const reload = s.rev !== session.rev;
        session = s;
        if (reload) resync().catch(console.error);
        else render();
      },
      onStatus: (status) => { if (status === "SUBSCRIBED") resync().catch(console.error); },
    });
    setInterval(() => resync().catch(() => {}), 20000);
  }

  async function resync() {
    if (DEMO) return render();
    const [s, all] = await Promise.all([getSession(), getWords(session.id)]);
    if (s) session = s;
    rows = all;
    render();
  }

  // ── 그리기 ──────────────────────────────────────────────────────
  function render() {
    PLATFORM.changed(session);
    const open = session.is_open;
    $("dot").classList.toggle("off", !open);
    $("status-text").textContent = open ? "응답 받는 중" : "응답 마감됨";
    $("open-toggle").setAttribute("aria-pressed", String(open));
    $("open-hint").textContent = open ? "지금 참여자가 단어를 보낼 수 있어요." : "마감했어요. 새 단어를 받지 않습니다.";
    if (!qDirty) $("q").value = session.question;

    // 이 화면에서 실행 중일 때만 잠급니다(서버 상태가 '정리 중'에 멈춰 있어도 다시 누를 수 있게).
    const loading = aiRunning;
    $("ai-run").disabled = busy;
    $("ai-run-label").textContent = loading ? "정리하는 중…" : "AI 정리 실행";
    const groups = session.ai_groups || [];
    $("ai-box").hidden = groups.length === 0;
    if (groups.length) {
      const kinds = groups.reduce((n, g) => n + (g.members ? g.members.length : 1), 0);
      $("ai-title").textContent = "최근 정리 결과 · 표현 " + kinds + "개 → 단어 " + groups.length + "개";
      const box = $("ai-chips");
      box.innerHTML = "";
      groups.forEach((g) => {
        const c = document.createElement("span");
        c.className = "chip";
        c.title = (g.members || []).join(", ");
        c.append(g.label + " ");
        const n = document.createElement("i");
        n.textContent = g.count;
        c.appendChild(n);
        box.appendChild(c);
      });
    }
    renderList();
  }

  function renderList() {
    const agg = aggregate(rows);
    $("people").textContent = agg.people + "명";
    $("total").textContent = agg.total + "개";
    const hiddenCount = agg.items.filter((d) => d.hidden).length;
    $("list-note").textContent = "많이 나온 순 · 서로 다른 단어 " + agg.items.length + "개 · 숨김 " + hiddenCount + "개";
    const list = $("list");
    list.innerHTML = "";
    if (!agg.items.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "아직 받은 단어가 없어요.";
      list.appendChild(empty);
      return;
    }
    agg.items.forEach((d) => {
      const tr = document.createElement("div");
      tr.className = "tr" + (d.hidden ? " hidden" : "");
      const w = document.createElement("span");
      w.className = "w";
      w.textContent = d.text;
      const c = document.createElement("span");
      c.className = "c";
      c.textContent = d.count;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn " + (d.hidden ? "" : "ghost");
      b.textContent = d.hidden ? "다시 보이기" : "숨기기";
      b.addEventListener("click", () =>
        act("hide_word", { normalized: d.key, hidden: !d.hidden }, b));
      tr.append(w, c, b);
      list.appendChild(tr);
    });
  }

  // ── 동작 ────────────────────────────────────────────────────────
  async function act(action, extra, button) {
    if (busy) return null;
    busy = true;
    if (button) button.disabled = true;
    try {
      const out = await api(action, extra);
      const reload = out.session.rev !== session.rev;
      session = out.session;
      if (reload) await resync(); else render();
      return out;
    } catch (err) {
      toast(err.message);
      return null;
    } finally {
      busy = false;
      if (button) button.disabled = false;
      render();
    }
  }

  $("q").addEventListener("input", () => { qDirty = true; });
  $("q-save").addEventListener("click", async (e) => {
    const question = $("q").value.trim();
    if (!question) return toast("질문을 적어 주세요");
    const out = await act("set_question", { question }, e.currentTarget);
    if (out) { qDirty = false; toast("질문을 저장했어요"); }
  });

  $("open-toggle").addEventListener("click", (e) =>
    act("set_open", { open: !session.is_open }, e.currentTarget));

  $("ai-run").addEventListener("click", async () => {
    $("ai-err").hidden = true;
    if (busy) return;
    busy = true;
    aiRunning = true;
    $("ai-run").disabled = true;
    $("ai-run-label").textContent = "정리하는 중…";
    try {
      const out = await api("ai_summary");
      session = out.session;
      const took = out.ai ? " (" + out.ai.seconds + "초 · " + out.ai.model + ")" : "";
      toast("AI 정리를 발표 화면에 보냈어요" + took);
      if (out.ai && out.ai.skipped && out.ai.skipped.length) console.warn("건너뛴 모델:", out.ai.skipped);
    } catch (err) {
      $("ai-err").textContent = "AI 정리에 실패했어요: " + err.message;
      $("ai-err").hidden = false;
      const fresh = await getSession().catch(() => null);
      if (fresh) session = fresh;
    }
    busy = false;
    aiRunning = false;
    render();
  });

  $("ai-clear").addEventListener("click", (e) => act("clear_ai", {}, e.currentTarget));

  // ── 내려받기 (CSV, 엑셀에서 바로 열림) ────────────────────────────
  function cell(v) {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // 엑셀이 수식으로 읽지 않게
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function download(name, table) {
    const csv = "﻿" + table.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n"; // BOM: 엑셀 한글 깨짐 방지
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
  }
  const when = (iso) => {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? d.toLocaleString("sv-SE") : ""; // 2026-11-17 14:03:22 (이 컴퓨터 시간대)
  };

  // 원본: 받은 답변을 한 줄씩. 참여자는 이름 없이 기기별 번호로만 구분합니다.
  $("raw-download").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await resync(); // 방금 들어온 답변까지
      if (!rows.length) return toast("아직 받은 단어가 없어요");
      const who = new Map();
      const table = [["질문", session.question], [],
        ["번호", "보낸 시각", "참여자", "단어", "숨김"]];
      rows.forEach((r, i) => {
        if (!who.has(r.client_id)) who.set(r.client_id, who.size + 1);
        table.push([i + 1, when(r.created_at), "참여자 " + who.get(r.client_id), r.word, r.hidden ? "숨김" : ""]);
      });
      download("워드클라우드-원본-" + stamp() + ".csv", table);
      toast("원본 " + rows.length + "줄을 내려받았어요");
    } catch (err) {
      toast("내려받지 못했어요: " + err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // AI 정리 결과: 대표 단어, 횟수, 묶인 표현
  $("ai-download").addEventListener("click", () => {
    const groups = session.ai_groups || [];
    if (!groups.length) return toast("먼저 AI 정리를 실행해 주세요");
    const table = [["질문", session.question], [],
      ["순위", "대표 단어", "횟수", "묶인 표현"]];
    groups.slice().sort((a, b) => b.count - a.count).forEach((g, i) => {
      table.push([i + 1, g.label, g.count, (g.members || [g.label]).join(", ")]);
    });
    download("워드클라우드-AI정리-" + stamp() + ".csv", table);
    toast("AI 정리 결과를 내려받았어요");
  });

  $("reset").addEventListener("click", async (e) => {
    if (!confirm("받은 단어와 AI 정리 결과를 모두 지울까요?\n되돌릴 수 없어요.")) return;
    const out = await act("reset", {}, e.currentTarget);
    if (out) toast("모두 지웠어요");
  });

  // ── 미리보기(demo) ───────────────────────────────────────────────
  function demoApi(action, extra) {
    const handled = PLATFORM.demoApi(action, extra, session);
    if (handled) return Promise.resolve(handled);
    if (action === "set_question") session.question = extra.question;
    if (action === "set_open") session.is_open = extra.open;
    if (action === "hide_word") rows.forEach((r) => { if (r.normalized === extra.normalized) r.hidden = extra.hidden; });
    if (action === "reset") { rows = []; session.ai_groups = null; }
    if (action === "clear_ai") session.ai_groups = null;
    return Promise.resolve({ ok: true, session: Object.assign({}, session) });
  }
  if (DEMO) {
    const sample = [["연결", 14], ["성장", 12], ["공감", 10], ["도전", 9], ["자유", 8], ["재미", 7], ["신뢰", 7],
      ["다양성", 6], ["용기", 5], ["존중", 5], ["소통", 5], ["여유", 4], ["워라밸", 1]];
    let id = 0;
    sample.forEach(([word, n]) => {
      for (let i = 0; i < n; i++) {
        rows.push({ id: ++id, word, normalized: word, hidden: word === "워라밸", client_id: "c" + (id % 37) });
      }
    });
    session = {
      id: "demo", question: "Gen Z Lab.의 8번째 프로그램을 기획한다면, 어떤 프로그램을 하면 좋을까요?", is_open: true, rev: 0, program: "lobby", notice: null, roster_rev: 0,
      ai_status: "done",
      ai_groups: [{ label: "연결", count: 19, members: ["연결", "소통"] }, { label: "성장", count: 12, members: ["성장"] },
        { label: "공감", count: 15, members: ["공감", "존중"] }, { label: "도전", count: 14, members: ["도전", "용기"] },
        { label: "자유", count: 12, members: ["자유", "여유"] }],
    };
    enter();
  }
})();
