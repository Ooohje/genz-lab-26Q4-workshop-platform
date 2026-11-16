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
        .select("id, word, normalized, hidden, client_id")
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

  window.WC = { cfg, code, db, normalize, getSession, getWords, aggregate, subscribe, joinUrl, qrSvg, toast };
})();
