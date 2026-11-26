// app: 참여자 화면의 뼈대.
// Knox ID로 입장하고, 진행자가 고른 프로그램(sessions.program)에 맞는 화면을 보여 줍니다.
//
// 프로그램을 추가하려면:
//   1) 아래 PROGRAMS 에 이름을 넣고  2) index.html 에 <section id="view-이름" class="view"> 를 만들고
//   3) supabase/platform.sql 의 check 목록과 admin 함수·관리 화면 버튼에도 같은 이름을 넣습니다.
(function () {
  const { db, getSession, subscribe, toast } = window.WC;
  const $ = (id) => document.getElementById(id);
  const PROGRAMS = ["lobby", "wordcloud", "dinner", "teamvote", "raid", "end"];
  const KEY = "wc-knox-id";
  const params = new URLSearchParams(location.search);
  // ?p=dinner 처럼 열면 진행 중인 프로그램과 상관없이 그 화면을 보여 줍니다(석식 투표 링크를 따로 돌릴 때).
  const forced = PROGRAMS.includes(params.get("p")) ? params.get("p") : null;

  let session = null;
  let me = null;         // { knox_id, name, team_no, team_name, teammates, dinner }
  let needsName = false; // 명단에 없는 Knox ID라 이름을 받아야 하는 상태
  let busy = false;
  let raidMounted = false;

  const saved = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const save = (v) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch (e) { /* 무시 */ } };

  async function rpc(name, args) {
    const { data, error } = await db.rpc(name, args);
    if (error) throw new Error(error.message);
    return data;
  }

  // platform.sql 을 아직 실행하지 않은 프로젝트에서는 예전처럼 워드클라우드만 보여 줍니다.
  const isPlatform = () => !!session && "program" in session;

  function currentView() {
    if (!session) return "loading";
    if (!isPlatform()) return "wordcloud";
    if (!me) return "login";
    return forced || session.program;
  }

  function render() {
    const view = currentView();
    // 보스 레이드는 js/raid.js 가 이 화면 안에 그립니다. 입장한 Knox ID로 자동으로 자기 자리에 들어갑니다.
    if (view === "raid" && me && window.WCRaid) {
      if (!raidMounted) { window.WCRaid.mountPhone($("raid-phone"), { knoxId: me.knox_id }); raidMounted = true; }
      else window.WCRaid.setKnox(me.knox_id);
    }
    document.querySelectorAll(".view").forEach((el) => { el.hidden = el.id !== "view-" + view; });
    window.WCJoin.setActive(view === "wordcloud");

    const notice = session && session.notice;
    $("notice").hidden = !notice || view === "login" || view === "loading";
    $("notice").textContent = notice || "";

    $("user").hidden = !me;
    if (me) {
      $("user-name").textContent = me.name;
      $("user-team").textContent = me.team_name || "조 미배정";
    }

    if (view === "login") {
      $("login-name-row").hidden = !needsName;
      $("login-help").textContent = needsName
        ? "명단에 없는 Knox ID예요. 이름을 적으면 입장할 수 있고, 조는 진행자가 배정해 드려요."
        : "Knox ID를 적으면 출석이 확인돼요.";
      $("login-btn").textContent = busy ? "확인하는 중…" : "출석하기";
      $("login-btn").disabled = busy;
    }

    if (view === "lobby" && me) {
      $("lobby-hello").textContent = me.name + "님, 반가워요!";
      $("lobby-team").textContent = me.team_name || "조 배정을 기다리는 중이에요";
      const mates = $("lobby-mates");
      mates.innerHTML = "";
      (me.teammates || []).forEach((n) => {
        const c = document.createElement("span");
        c.className = "chip";
        c.textContent = n;
        mates.appendChild(c);
      });
      $("lobby-mates-wrap").hidden = !(me.teammates || []).length;
    }

    if (view === "dinner" && me) {
      // 이미 응답했으면 완료 화면, "다시 바꾸기"를 누르면 고르는 화면으로 돌아갑니다.
      const done = !!me.dinner && !dinnerEditing;
      $("dinner-ask").hidden = done;
      $("dinner-done").hidden = !done;
      const word = { yes: "참석", no: "미참석" };
      if (done) {
        $("dinner-done-badge").textContent = word[me.dinner];
        $("dinner-done-title").textContent = me.name + "님, " + word[me.dinner] + "으로 받았어요";
      } else {
        const pick = dinnerPick || me.dinner;
        ["yes", "no"].forEach((c) => {
          const b = $("dinner-" + c);
          b.setAttribute("aria-pressed", String(pick === c));
          b.disabled = busy;
        });
        $("dinner-status").textContent = pick ? word[pick] + "을 골랐어요. 확인을 누르면 저장돼요." : "하나를 고르고 확인을 눌러 주세요.";
        $("dinner-confirm").disabled = busy || !pick;
        $("dinner-confirm").textContent = busy ? "저장하는 중…" : "확인";
      }
    }

    if (view === "teamvote" && me) {
      const done = !!(tv && tv.vote != null) && !tvEditing;
      $("tv-ask").hidden = done;
      $("tv-done").hidden = !done;
      if (done) {
        $("tv-done-title").textContent = (tv.vote_name || tv.vote + "조") + "에 투표했어요";
      } else {
        const picked = tvPick != null ? tvPick : tv ? tv.vote : null;
        const box = $("tv-choices");
        box.innerHTML = "";
        ((tv && tv.candidates) || []).forEach((t) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "choice";
          b.textContent = t.name;
          b.setAttribute("aria-pressed", String(picked === t.team_no));
          b.disabled = busy;
          b.addEventListener("click", () => { if (!busy) { tvPick = t.team_no; render(); } });
          box.appendChild(b);
        });
        const chosen = ((tv && tv.candidates) || []).find((t) => t.team_no === picked);
        $("tv-status").textContent = !tv ? "투표를 준비하고 있어요. 잠시만 기다려 주세요."
          : !tv.candidates.length ? "투표할 조가 아직 없어요."
          : chosen ? chosen.name + "을(를) 골랐어요. 확인을 누르면 저장돼요."
          : "한 조를 고르고 확인을 눌러 주세요.";
        $("tv-confirm").disabled = busy || !chosen;
        $("tv-confirm").textContent = busy ? "저장하는 중…" : "확인";
      }
    }
  }

  // ── 발표 우수팀 투표 ─────────────────────────────────────────────
  let tv = null;          // { vote, vote_name, candidates: [{team_no, name}] } — 서버가 본인 조를 빼고 줍니다
  let tvPick = null;      // 아직 저장하지 않은 선택
  let tvEditing = false;  // "다시 바꾸기"를 눌러 고르는 화면으로 돌아온 상태
  async function refreshTeamvote() {
    if (!me) { tv = null; return; }
    try {
      tv = await rpc("wc_teamvote_state", { p_knox_id: me.knox_id });
    } catch (e) { /* teamvote.sql 을 아직 실행하지 않았거나 잠깐 끊긴 경우: 있던 값을 그대로 둡니다 */ }
  }
  $("tv-confirm").addEventListener("click", async () => {
    const choice = tvPick != null ? tvPick : tv && tv.vote;
    if (!me || busy || choice == null) return;
    busy = true;
    render();
    try {
      tv = await rpc("wc_teamvote", { p_knox_id: me.knox_id, p_team_no: choice });
      tvPick = null;
      tvEditing = false;
    } catch (err) {
      toast(err.message || "저장하지 못했어요. 다시 눌러 주세요");
      await refreshTeamvote();
    }
    busy = false;
    render();
  });
  $("tv-change").addEventListener("click", () => {
    tvEditing = true;
    tvPick = null;
    render();
  });

  // ── 입장 ────────────────────────────────────────────────────────
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const knox = $("login-knox").value.trim().toLowerCase();
    const name = $("login-name").value.trim();
    if (!knox) return toast("Knox ID를 적어 주세요");
    if (needsName && !name) return toast("이름을 적어 주세요");
    busy = true;
    render();
    try {
      const out = await rpc("wc_enter", { p_knox_id: knox, p_name: needsName ? name : null });
      if (out.found) {
        me = out;
        needsName = false;
        save(me.knox_id);
        await refreshTeamvote();
      } else {
        needsName = true;
      }
    } catch (err) {
      toast(err.message);
    }
    busy = false;
    render();
    if (needsName) $("login-name").focus();
  });
  $("login-knox").addEventListener("input", () => {
    if (needsName) { needsName = false; render(); }
  });

  $("user").addEventListener("click", async () => {
    if (await window.WC.ask("로그아웃하고 다른 Knox ID로 다시 출석할까요?")) $("logout").click();
  });
  $("logout").addEventListener("click", () => {
    // 로그아웃하면 입장도 취소합니다(관리 화면의 입장 인원에서 빠짐). 투표한 내용은 남습니다.
    // leave.sql 을 아직 실행하지 않았으면 조용히 넘어갑니다.
    if (me) db.rpc("wc_leave", { p_knox_id: me.knox_id }).then(() => {}, () => {});
    clearLocal();
    render();
  });
  // 이 휴대폰에 남은 입장 정보를 지웁니다(서버는 건드리지 않음).
  function clearLocal() {
    me = null;
    tv = null;
    tvPick = null;
    tvEditing = false;
    needsName = false;
    save(null);
    $("login-knox").value = "";
    $("login-name").value = "";
  }

  // ── 출석 초기화 ─────────────────────────────────────────────────
  // 진행자가 "출석 초기화"를 누르면 sessions.entry_rev 가 1 올라갑니다.
  // 이 휴대폰이 기억하는 값과 다르면 로그아웃해서 첫 화면(출석)으로 돌아갑니다.
  // attendance.sql 을 아직 실행하지 않았으면(entry_rev 없음) 아무 일도 하지 않습니다.
  const REV_KEY = "wc-entry-rev";
  function syncReset() {
    if (!session || !("entry_rev" in session)) return false;
    const cur = String(session.entry_rev);
    let stored = null;
    try { stored = localStorage.getItem(REV_KEY); } catch (e) { /* 무시 */ }
    const out = !!(me || saved()) && (stored || "0") !== cur;
    if (out) {
      clearLocal();
      toast("진행자가 출석을 초기화했어요. 다시 출석해 주세요");
    }
    try { localStorage.setItem(REV_KEY, cur); } catch (e) { /* 무시 */ }
    return out;
  }

  // ── 석식 투표 ───────────────────────────────────────────────────
  // 참석/미참석을 누르면 고르기만 하고, "확인"을 눌러야 저장합니다.
  let dinnerPick = null;      // 아직 저장하지 않은 선택
  let dinnerEditing = false;  // "다시 바꾸기"를 눌러 고르는 화면으로 돌아온 상태
  const pick = (choice) => { if (!busy) { dinnerPick = choice; render(); } };
  $("dinner-yes").addEventListener("click", () => pick("yes"));
  $("dinner-no").addEventListener("click", () => pick("no"));
  $("dinner-confirm").addEventListener("click", async () => {
    const choice = dinnerPick || (me && me.dinner);
    if (!me || busy || !choice) return;
    busy = true;
    render();
    try {
      const out = await rpc("wc_dinner", { p_knox_id: me.knox_id, p_choice: choice });
      me.dinner = out.dinner;
      dinnerPick = null;
      dinnerEditing = false;
    } catch (err) {
      toast("저장하지 못했어요. 다시 눌러 주세요");
    }
    busy = false;
    render();
  });
  $("dinner-change").addEventListener("click", () => {
    dinnerEditing = true;
    dinnerPick = null;
    render();
  });

  // ── 내 정보 다시 읽기 (조가 바뀌었을 때 등) ───────────────────────
  async function refreshMe() {
    syncReset(); // 출석이 초기화됐으면 여기서 로그아웃되어, 아래에서 다시 참석으로 잡히지 않습니다
    const id = me ? me.knox_id : saved();
    if (!id || !isPlatform()) return;
    try {
      const out = await rpc("wc_me", { p_knox_id: id });
      if (out.found) me = out;
      else { me = null; save(null); } // 명단에서 지워진 경우 다시 입장
    } catch (e) { /* 잠깐 끊겨도 화면은 그대로 둡니다 */ }
    await refreshTeamvote(); // 조가 바뀌면 고를 수 있는 조도 달라집니다
  }

  async function start() {
    try {
      session = await getSession();
    } catch (e) {
      session = null;
    }
    if (!session) {
      $("loading-text").textContent = "진행 중인 워크샵을 찾지 못했어요. 새로고침해 주세요.";
      return;
    }
    await Promise.all([window.WCJoin.init(session), refreshMe()]);
    render();

    subscribe(session.id, {
      onSession: async (s) => {
        const rosterChanged = s.roster_rev !== session.roster_rev;
        session = s;
        syncReset();
        await window.WCJoin.setSession(s);
        if (rosterChanged) await refreshMe();
        render();
      },
    });

    // 화면을 껐다 켜면 실시간 연결이 끊겼을 수 있으니 다시 맞춥니다.
    document.addEventListener("visibilitychange", async () => {
      if (document.hidden) return;
      const fresh = await getSession().catch(() => null);
      if (!fresh) return;
      session = fresh;
      await Promise.all([window.WCJoin.setSession(fresh), refreshMe()]);
      render();
    });
  }

  start();
})();
