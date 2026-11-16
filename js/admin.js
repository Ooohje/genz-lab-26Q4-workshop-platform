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

  $("reset").addEventListener("click", async (e) => {
    if (!confirm("받은 단어와 AI 정리 결과를 모두 지울까요?\n되돌릴 수 없어요.")) return;
    const out = await act("reset", {}, e.currentTarget);
    if (out) toast("모두 지웠어요");
  });

  // ── 미리보기(demo) ───────────────────────────────────────────────
  function demoApi(action, extra) {
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
      id: "demo", question: "9기 Gen Z Lab. Crew가 된다면 더 해보고 싶은 활동을 자유롭게 말해주세요", is_open: true, rev: 0,
      ai_status: "done",
      ai_groups: [{ label: "연결", count: 19, members: ["연결", "소통"] }, { label: "성장", count: 12, members: ["성장"] },
        { label: "공감", count: 15, members: ["공감", "존중"] }, { label: "도전", count: 14, members: ["도전", "용기"] },
        { label: "자유", count: 12, members: ["자유", "여유"] }],
    };
    enter();
  }
})();
