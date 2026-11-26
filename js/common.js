// 세 화면이 함께 쓰는 Supabase 연결과 도우미 함수
(function () {
  const cfg = window.WORDCLOUD_CONFIG;
  const params = new URLSearchParams(location.search);
  const codeInUrl = params.get("s");
  const code = codeInUrl || cfg.sessionCode;

  const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const normalize = (s) => String(s).replace(/\s+/g, "").toLowerCase();

  async function getSession() {
    const { data, error } = await db.from("sessions").select("*").eq("code", code).maybeSingle();
    if (error) throw error;
    return data;
  }

  // 한 번에 1000줄까지만 내려오므로 끝까지 나눠 읽습니다.
  async function getWords(sessionId) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from("words")
        .select("id, word, normalized, hidden, client_id, created_at")
        .eq("session_id", sessionId)
        .order("created_at")
        .order("id")
        .range(from, from + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) break;
    }
    return rows;
  }

  // 정규화 기준으로 같은 단어를 합칩니다. 화면에 보이는 글자는 가장 많이 쓰인 표기입니다.
  function aggregate(rows) {
    const map = new Map();
    const people = new Set();
    let total = 0;
    for (const r of rows) {
      let item = map.get(r.normalized);
      if (!item) {
        item = { key: r.normalized, text: r.word, count: 0, hidden: false, forms: new Map() };
        map.set(r.normalized, item);
      }
      item.count++;
      // 화면에는 가장 많이 쓰인 표기를 보여 줍니다('연 결'보다 '연결').
      const n = (item.forms.get(r.word) || 0) + 1;
      item.forms.set(r.word, n);
      if (n > (item.forms.get(item.text) || 0)) item.text = r.word;
      if (r.hidden) item.hidden = true;
      else {
        total++;
        people.add(r.client_id);
      }
    }
    const items = [...map.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, "ko"));
    return { items, total, people: people.size };
  }

  // words 추가와 sessions 변경을 실시간으로 받습니다.
  function subscribe(sessionId, handlers) {
    return db
      .channel("wc-" + sessionId + "-" + Math.random().toString(36).slice(2, 8))
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "words", filter: "session_id=eq." + sessionId },
        (p) => handlers.onWord && handlers.onWord(p.new),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "sessions", filter: "id=eq." + sessionId },
        (p) => handlers.onSession && handlers.onSession(p.new),
      )
      .subscribe((status) => handlers.onStatus && handlers.onStatus(status));
  }

  // 참여 주소 (QR과 화면 표시용)
  function joinUrl() {
    const u = new URL("./", location.href);
    u.search = codeInUrl ? "?s=" + encodeURIComponent(codeInUrl) : "";
    u.hash = "";
    return u.href;
  }

  function qrSvg(text) {
    const qr = window.qrcode(0, "M");
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }

  let toastTimer;
  function toast(message) {
    let el = document.querySelector(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
  }

  // 확인창·입력창. 브라우저 기본 confirm()/prompt() 는 앱 안 브라우저 등에서 창을 띄우지 않고 바로 "취소"를 돌려주는 경우가 있어
  // 화면 안에 직접 그립니다. ask → true/false, askText → 적은 글자 또는 null (Promise).
  function dialog(message, opts) {
    return new Promise((resolve) => {
      const back = document.createElement("div");
      back.setAttribute("role", "dialog");
      back.setAttribute("aria-modal", "true");
      back.style.cssText = "position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(31,37,64,.45);font-family:inherit";
      const box = document.createElement("div");
      box.style.cssText = "width:min(420px,100%);padding:24px;border-radius:24px;background:#fff;color:#1F2540;box-shadow:0 20px 60px rgba(31,37,64,.35);display:flex;flex-direction:column;gap:16px";
      const text = document.createElement("div");
      text.style.cssText = "font-size:16px;line-height:1.55;font-weight:600;white-space:pre-line;overflow-wrap:anywhere";
      text.textContent = message;
      box.appendChild(text);
      let input = null;
      if (opts && opts.input) {
        input = document.createElement("input");
        input.type = "text";
        input.value = opts.value || "";
        input.maxLength = opts.maxLength || 40;
        input.style.cssText = "height:48px;padding:0 14px;border-radius:14px;border:1.5px solid rgba(31,37,64,.25);font:inherit;font-size:16px;color:#1F2540;background:#fff;outline:none";
        box.appendChild(input);
      }
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:10px;justify-content:flex-end";
      const mk = (label, bg, fg) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.style.cssText = "height:44px;padding:0 20px;border-radius:999px;border:none;cursor:pointer;font:inherit;font-size:15px;font-weight:700;background:" + bg + ";color:" + fg;
        return b;
      };
      const no = mk("취소", "rgba(31,37,64,.1)", "#1F2540");
      const yes = mk("확인", "#F4775C", "#1F2540");
      row.append(no, yes);
      box.appendChild(row);
      back.appendChild(box);
      const done = (ok) => {
        document.removeEventListener("keydown", onKey, true);
        back.remove();
        resolve(input ? (ok ? input.value : null) : ok);
      };
      const onKey = (e) => {
        if (e.key === "Escape") { e.preventDefault(); done(false); }
        else if (e.key === "Enter") { e.preventDefault(); done(true); }
      };
      no.addEventListener("click", () => done(false));
      yes.addEventListener("click", () => done(true));
      back.addEventListener("click", (e) => { if (e.target === back) done(false); });
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(back);
      (input || yes).focus();
      if (input) input.select();
    });
  }
  const ask = (message) => dialog(message);
  const askText = (message, value, maxLength) => dialog(message, { input: true, value, maxLength });

  window.WC = { cfg, code, db, normalize, getSession, getWords, aggregate, subscribe, joinUrl, qrSvg, toast, ask, askText };
})();
