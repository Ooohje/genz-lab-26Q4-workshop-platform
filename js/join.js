// join: 워드클라우드 프로그램의 참여자 화면(답변을 적어 보내는 부분).
// 화면 전환과 세션 구독은 js/app.js 가 맡고, 여기서는 window.WCJoin 으로 불려 그리기만 합니다.
(function () {
  const { db, getSession, toast } = window.WC;
  const MAX_LEN = 30;
  const $ = (id) => document.getElementById(id);

  // 브라우저마다 임의 번호 하나(익명). 참여 인원을 세고 "내가 보낸 답변"을 찾는 데만 씁니다.
  // Knox ID와 연결하지 않으므로 누가 어떤 답변을 보냈는지는 남지 않습니다.
  function clientId() {
    const KEY = "wc-client-id";
    let id = null;
    try { id = localStorage.getItem(KEY); } catch (e) { /* 사생활 보호 모드 */ }
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID()
        : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
            (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
      try { localStorage.setItem(KEY, id); } catch (e) { /* 저장 못 해도 계속 */ }
    }
    return id;
  }
  const me = clientId();

  let session = null;
  let active = false;    // 지금 워드클라우드 화면이 보이는 중인지
  let mine = [];         // 내가 보낸 답변
  let values = ["", ""]; // 입력칸
  let sending = false;

  function renderRows(focusLast) {
    const rows = $("rows");
    rows.innerHTML = "";
    rows.style.cssText = "display:flex;flex-direction:column;gap:12px";
    values.forEach((v, i) => {
      const row = document.createElement("div");
      row.className = "row";
      const input = document.createElement("input");
      input.className = "field";
      input.type = "text";
      input.maxLength = MAX_LEN;
      input.value = v;
      input.placeholder = "답변 " + (i + 1);
      input.setAttribute("aria-label", "답변 " + (i + 1));
      input.autocomplete = "off";
      input.enterKeyHint = "next";
      const counter = document.createElement("span");
      counter.className = "counter";
      counter.setAttribute("aria-hidden", "true");
      counter.textContent = v.length + "/" + MAX_LEN;
      input.addEventListener("input", () => {
        values[i] = input.value;
        counter.textContent = input.value.length + "/" + MAX_LEN;
        renderSend();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || e.isComposing) return;
        e.preventDefault();
        const next = rows.querySelectorAll("input")[i + 1];
        if (next) next.focus(); else send();
      });
      row.append(input, counter);
      rows.appendChild(row);
    });
    if (focusLast) rows.querySelector(".row:last-child input").focus();
  }

  const filled = () => values.map((v) => v.trim()).filter(Boolean);

  function renderSend() {
    const n = filled().length;
    const btn = $("send");
    btn.disabled = n === 0 || sending;
    btn.textContent = sending ? "보내는 중…" : n > 0 ? n + "개 보내기" : mine.length ? "더 보내기" : "보내기";
  }

  function chips(el) {
    el.innerHTML = "";
    mine.forEach((w) => {
      const c = document.createElement("span");
      c.className = "chip";
      c.textContent = w;
      el.appendChild(c);
    });
  }

  function render() {
    if (!session) return;
    const open = session.is_open;
    const sent = mine.length > 0;

    $("send-bar").hidden = !active || !open;
    if (!active) return;

    $("question").textContent = session.question;
    $("closed").hidden = open;
    $("form").hidden = !open;
    $("hint").hidden = !open;
    $("sent").hidden = !open || !sent;

    if (open) {
      // 캐릭터는 맨 위 카드에만
      $("form").classList.toggle("with-mascot", !sent);
      $("form-mascot").hidden = sent;
      $("form-title").textContent = sent ? "더 적고 싶은 것이 있나요?" : "자유롭게 적어 주세요";
      chips($("sent-chips"));
      renderSend();
    } else {
      $("closed-mine").hidden = !sent;
      chips($("closed-chips"));
    }
  }

  async function loadMine() {
    const { data, error } = await db
      .from("words").select("word")
      .eq("session_id", session.id).eq("client_id", me).eq("hidden", false)
      .order("created_at");
    if (!error) mine = data.map((r) => r.word);
  }

  async function send() {
    const words = filled();
    if (!words.length || sending || !session) return;
    sending = true;
    renderSend();
    const { error } = await db.from("words").insert(
      words.map((word) => ({ session_id: session.id, word, client_id: me })),
    );
    sending = false;
    if (error) {
      // 그 사이 마감됐을 수 있으니 세션을 다시 확인
      const fresh = await getSession().catch(() => null);
      if (fresh) session = fresh;
      if (session.is_open) {
        toast(/30개/.test(error.message) ? "한 사람당 30개까지 보낼 수 있어요"
          : "보내지 못했어요. 잠시 후 다시 눌러 주세요");
      }
      render();
      return;
    }
    mine.push(...words);
    values = [""];
    renderRows(false);
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $("add").addEventListener("click", () => {
    if (values.length >= 10) return toast("입력칸은 한 번에 10개까지예요");
    values.push("");
    renderRows(true);
  });
  $("send").addEventListener("click", send);

  window.WCJoin = {
    // 처음 한 번: 내 답변을 읽고 입력칸을 만듭니다.
    async init(s) {
      session = s;
      await loadMine();
      renderRows(false);
      render();
    },
    // 세션이 바뀔 때마다(실시간): 초기화·숨기기가 있었으면 내 답변도 다시 확인합니다.
    async setSession(s) {
      const reset = session && s.rev !== session.rev;
      session = s;
      if (reset) await loadMine();
      render();
    },
    // 워드클라우드 화면이 보이게/안 보이게 될 때
    setActive(on) {
      active = on;
      render();
    },
  };
})();
