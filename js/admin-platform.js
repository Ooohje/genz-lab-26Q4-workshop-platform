// admin-platform: 관리 화면의 메인 관제 · 명단/조 · 석식 투표 탭.
// 워드클라우드 탭은 js/admin.js 가 맡고, 로그인·서버 호출(api)은 admin.js 에서 넘겨받습니다.
(function () {
  const $ = (id) => document.getElementById(id);
  const STAFF = /chief|치프/i;         // 운영진 조: 출석 집계에서 뺍니다
  let ctx = null;                     // { api, demo, toast, getSession, setSession }
  let roster = { teams: [], participants: [] };
  let rosterRev = null;
  let ready = false;                  // 서버 쪽(platform.sql + admin 함수)이 준비됐는지
  let busy = false;
  let noticeDirty = false;
  let voteReady;                      // 우수팀 투표: 서버(teamvote.sql + 새 admin 함수)가 준비됐으면 true

  // ── 탭 ──────────────────────────────────────────────────────────
  function showTab(name) {
    document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === name)));
    document.querySelectorAll(".tabpane").forEach((p) => { p.hidden = p.id !== "tab-" + name; });
    if (name === "dinner" || name === "roster" || name === "teamvote") loadRoster();
  }
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

  // ── 서버 호출 ───────────────────────────────────────────────────
  async function call(action, extra, button) {
    if (!ctx || busy) return null;
    busy = true;
    if (button) button.disabled = true;
    try {
      const out = await ctx.api(action, extra);
      if (out.teams) { roster = { teams: out.teams, participants: out.participants }; voteReady = out.teamvote_ready; }
      if (out.session) { rosterRev = out.session.roster_rev; ctx.setSession(out.session); }
      render();
      return out;
    } catch (err) {
      ctx.toast(err.message);
      return null;
    } finally {
      busy = false;
      if (button) button.disabled = false;
    }
  }

  async function loadRoster() {
    if (!ctx || !ready) return;
    try {
      const out = await ctx.api("roster");
      roster = { teams: out.teams, participants: out.participants };
      voteReady = out.teamvote_ready;
      $("platform-msg").hidden = true;
      render();
    } catch (err) {
      // 함수가 예전 버전이면 '알 수 없는 동작' 이 돌아옵니다.
      $("platform-msg").textContent = /알 수 없는 동작/.test(err.message)
        ? "명단·석식 기능을 쓰려면 Edge Function(admin)을 새 코드로 다시 배포해 주세요."
        : "명단을 불러오지 못했어요: " + err.message;
      $("platform-msg").hidden = false;
    }
  }

  // ── 그리기 ──────────────────────────────────────────────────────
  const teamName = (no) => {
    const t = roster.teams.find((x) => x.team_no === no);
    return t ? t.name : no == null ? "미배정" : no + "조";
  };

  function render() {
    if (!ctx) return;
    const session = ctx.getSession();
    const people = roster.participants;

    // 메인 관제
    document.querySelectorAll(".program").forEach((b) => {
      b.setAttribute("aria-pressed", String(ready && session.program === b.dataset.program));
      b.disabled = !ready;
    });
    if (!noticeDirty) $("notice-text").value = session.notice || "";
    // 출석은 운영진 조(이름에 Chief·치프가 들어간 조)를 빼고 셉니다.
    const staffTeams = new Set(roster.teams.filter((t) => STAFF.test(t.name)).map((t) => t.team_no));
    const counted = people.filter((p) => !staffTeams.has(p.team_no));
    const joined = counted.filter((p) => p.joined_at).length;
    const absent = counted.length - joined;
    $("c-roster").textContent = counted.length + "명";
    $("c-joined").textContent = joined + "명";
    $("c-absent").textContent = absent + "명";
    const walkIns = people.filter((p) => !p.is_preregistered).length;
    const unassigned = people.filter((p) => p.team_no == null).length;
    const staffCount = people.length - counted.length;
    $("c-note").textContent = (staffCount ? "Chief Crew " + staffCount + "명은 세지 않습니다 · " : "")
      + "명단에 없이 들어온 사람 " + walkIns + "명 · 조 미배정 " + unassigned + "명";

    // 조 이름
    const chips = $("team-chips");
    chips.innerHTML = "";
    roster.teams.forEach((t) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn ghost";
      const n = people.filter((p) => p.team_no === t.team_no).length;
      b.textContent = t.name + " · " + n + "명";
      b.title = t.team_no + "조 이름 바꾸기";
      b.addEventListener("click", () => {
        const name = prompt(t.team_no + "조의 이름", t.name);
        if (name && name.trim() && name.trim() !== t.name) call("team_rename", { team_no: t.team_no, name: name.trim() }, b);
      });
      chips.appendChild(b);
    });
    if (!roster.teams.length) chips.textContent = "아직 조가 없어요. 명단을 올리면 자동으로 만들어집니다.";

    // 참가자 목록: 조마다 박스 하나 (조 번호 순, 미배정은 맨 끝). 박스 안은 이름 순.
    $("roster-note").textContent = "전체 " + counted.length + "명 중 참석 " + joined + "명 · 미참석 " + absent + "명" + (staffCount ? " (Chief Crew " + staffCount + "명 제외)" : "");
    const list = $("roster-list");
    // 추가 칸에 적는 중이면 목록을 다시 그리지 않습니다(15초마다 새로 읽을 때 글자가 지워지지 않게).
    const typing = document.activeElement;
    if (typing && typing.tagName === "INPUT" && list.contains(typing)) return renderDinner();
    list.innerHTML = "";
    if (!people.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "아직 명단이 없어요. 왼쪽에서 명단을 올려 주세요.";
      list.appendChild(empty);
    }
    const boxes = roster.teams.map((t) => ({ no: t.team_no, title: t.name }));
    if (people.some((p) => p.team_no == null)) boxes.push({ no: null, title: "미배정" });
    boxes.forEach((box, index) => {
      // 참석한 사람이 위, 미참석이 아래. 그 안에서는 이름 순.
      const members = people.filter((p) => p.team_no === box.no)
        .sort((a, b) => (a.joined_at ? 0 : 1) - (b.joined_at ? 0 : 1) || a.name.localeCompare(b.name, "ko"));
      const el = document.createElement("div");
      el.className = "teambox " + (box.no == null ? "none" : "c" + (index % 5));
      const head = document.createElement("div");
      head.className = "teambox-head";
      const title = document.createElement("b");
      title.textContent = box.title;
      const count = document.createElement("span");
      const here = members.filter((p) => p.joined_at).length;
      count.textContent = staffTeams.has(box.no)
        ? members.length + "명 · 출석 집계에서 제외"
        : members.length + "명 · 참석 " + here + " · 미참석 " + (members.length - here);
      head.append(title, count);
      el.appendChild(head);
      if (!members.length) {
        const none = document.createElement("div");
        none.className = "empty";
        none.textContent = "아직 아무도 없어요.";
        el.appendChild(none);
      }
      members.forEach((p) => el.appendChild(personRow(p, staffTeams.has(box.no))));
      el.appendChild(addRow(box));
      list.appendChild(el);
    });

    renderDinner();
  }

  // 조 박스 맨 아래의 "이 조에 사람 추가" 줄. 적다 만 내용은 다시 그려도 남도록 drafts 에 둡니다.
  const drafts = {};
  function addRow(box) {
    const key = String(box.no);
    const draft = drafts[key] || (drafts[key] = { knox: "", name: "" });
    const form = document.createElement("form");
    form.className = "tr addrow";
    const input = (field, placeholder, max) => {
      const i = document.createElement("input");
      i.className = "sel";
      i.placeholder = placeholder;
      i.maxLength = max;
      i.autocomplete = "off";
      i.spellcheck = false;
      i.value = draft[field];
      i.setAttribute("aria-label", box.title + "에 추가할 사람의 " + placeholder);
      i.addEventListener("input", () => { draft[field] = i.value; });
      return i;
    };
    const name = input("name", "이름", 30);
    const knox = input("knox", "Knox ID", 40);
    const add = document.createElement("button");
    add.type = "submit";
    add.className = "btn";
    add.textContent = "추가";
    form.append(name, knox, add);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const row = { knox_id: knox.value.trim().toLowerCase(), name: name.value.trim(), team_no: box.no == null ? null : String(box.no) };
      if (!row.name || !row.knox_id) return ctx.toast("이름과 Knox ID를 모두 적어 주세요");
      const cur = roster.participants.find((p) => p.knox_id === row.knox_id);
      if (cur && !confirm(row.knox_id + " 은(는) 이미 명단에 있어요 (" + cur.name + " · " + teamName(cur.team_no) + ").\n" + box.title + "(으)로 옮기고 이름을 " + row.name + "(으)로 바꿀까요?")) return;
      drafts[key] = { knox: "", name: "" };
      if (document.activeElement) document.activeElement.blur();
      const out = await call("roster_import", { rows: [row], replace: false }, add);
      if (out) ctx.toast(row.name + " 님을 " + box.title + "에 추가했어요");
      else { drafts[key] = { knox: row.knox_id, name: row.name }; render(); }
    });
    return form;
  }

  // staff: 운영진 조(Chief Crew)는 출석을 세지 않으므로 색을 칠하지 않습니다.
  function personRow(p, staff) {
    {
      const tr = document.createElement("div");
      tr.className = "tr roster " + (staff ? "staff" : p.joined_at ? "in" : "out");
      const name = document.createElement("span");
      name.className = "w";
      name.textContent = p.name;
      const knox = document.createElement("span");
      knox.className = "k";
      knox.textContent = p.knox_id;
      const state = document.createElement("span");
      state.className = "att";
      state.textContent = staff ? "관리자" : p.joined_at ? "참석" : "미참석";
      const select = document.createElement("select");
      select.className = "sel";
      select.setAttribute("aria-label", p.name + "의 조");
      const opt = (value, label) => {
        const o = document.createElement("option");
        o.value = value;
        o.textContent = label;
        select.appendChild(o);
      };
      opt("", "미배정");
      roster.teams.forEach((t) => opt(String(t.team_no), t.name));
      select.value = p.team_no == null ? "" : String(p.team_no);
      select.addEventListener("change", () =>
        call("participant_update", { knox_id: p.knox_id, team_no: select.value === "" ? null : Number(select.value) }, select));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn ghost";
      del.textContent = "삭제";
      del.addEventListener("click", () => {
        if (confirm(p.name + " (" + p.knox_id + ") 님을 명단에서 지울까요?")) call("participant_delete", { knox_id: p.knox_id }, del);
      });
      tr.append(name, knox, state, select, del);
      return tr;
    }
  }

  function renderDinner() {
    renderTeamvote();
    const people = roster.participants;
    // 석식 투표
    const groups = {
      yes: people.filter((p) => p.dinner === "yes"),
      no: people.filter((p) => p.dinner === "no"),
      none: people.filter((p) => !p.dinner),
    };
    Object.keys(groups).forEach((k) => {
      $("d-" + k).textContent = groups[k].length + "명";
      $("d-" + k + "-n").textContent = groups[k].length + "명";
      const box = $("d-" + k + "-list");
      box.innerHTML = "";
      groups[k].slice().sort((a, b) => a.name.localeCompare(b.name, "ko")).forEach((p) => {
        const row = document.createElement("div");
        const b = document.createElement("b");
        b.textContent = p.name;
        const s = document.createElement("span");
        s.textContent = p.knox_id + (p.team_no != null ? " · " + teamName(p.team_no) : "");
        row.append(b, s);
        box.appendChild(row);
      });
      if (!groups[k].length) box.textContent = "없음";
    });
  }

  // 발표 우수팀 투표: 후보 조마다 받은 표. 본인 조 제외는 서버(wc_teamvote)가 지킵니다.
  function renderTeamvote() {
    const people = roster.participants;
    const voted = people.filter((p) => p.vote != null).length;
    $("v-done").textContent = voted + "명";
    $("v-none").textContent = (people.length - voted) + "명";
    const list = $("v-list");
    list.innerHTML = "";
    if (voteReady !== true) {
      const msg = document.createElement("div");
      msg.className = "empty";
      msg.textContent = "우수팀 투표를 쓰려면 Supabase SQL Editor에서 supabase/teamvote.sql 을 실행하고, Edge Function(admin)을 새 코드로 다시 배포해 주세요.";
      list.appendChild(msg);
      $("v-lead").textContent = "";
      $("v-out-label").hidden = true;
      $("v-out").innerHTML = "";
      return;
    }
    const count = (no) => people.filter((p) => p.vote === no).length;
    const rows = roster.teams.filter((t) => t.votable !== false)
      .map((t) => ({ t, n: count(t.team_no) }))
      .sort((a, b) => b.n - a.n || a.t.team_no - b.t.team_no);
    const max = rows.length ? rows[0].n : 0;
    const leaders = rows.filter((r) => max > 0 && r.n === max);
    $("v-lead").textContent = !max ? "아직 표가 없어요" : "지금 1위: " + leaders.map((r) => r.t.name).join(", ") + " (" + max + "표)";
    rows.forEach((r) => {
      const row = document.createElement("div");
      row.className = "voterow" + (max > 0 && r.n === max ? " top" : "");
      const name = document.createElement("b");
      name.textContent = r.t.name;
      const bar = document.createElement("div");
      bar.className = "bar";
      const fill = document.createElement("i");
      fill.style.width = (max ? Math.round((r.n / max) * 100) : 0) + "%";
      bar.appendChild(fill);
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = r.n + "표";
      const out = document.createElement("button");
      out.type = "button";
      out.className = "btn ghost";
      out.textContent = "후보에서 빼기";
      out.addEventListener("click", () => {
        if (r.n && !confirm(r.t.name + "을(를) 후보에서 빼면 받은 " + r.n + "표도 지워져요. 뺄까요?")) return;
        call("team_votable", { team_no: r.t.team_no, votable: false }, out);
      });
      row.append(name, bar, n, out);
      list.appendChild(row);
    });
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "후보 조가 없어요.";
      list.appendChild(empty);
    }
    const outBox = $("v-out");
    outBox.innerHTML = "";
    const excluded = roster.teams.filter((t) => t.votable === false);
    $("v-out-label").hidden = !excluded.length;
    excluded.forEach((t) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn ghost";
      b.textContent = t.name;
      b.title = t.name + "을(를) 다시 후보에 넣기";
      b.addEventListener("click", () => call("team_votable", { team_no: t.team_no, votable: true }, b));
      outBox.appendChild(b);
    });
  }

  $("v-refresh").addEventListener("click", loadRoster);
  $("v-reset").addEventListener("click", async (e) => {
    if (!confirm("우수팀 투표를 모두 지울까요?\n되돌릴 수 없어요.")) return;
    const out = await call("teamvote_reset", {}, e.currentTarget);
    if (out) ctx.toast("우수팀 투표를 지웠어요");
  });

  // ── 동작 ────────────────────────────────────────────────────────
  document.querySelectorAll(".program").forEach((b) =>
    b.addEventListener("click", () => call("set_program", { program: b.dataset.program }, b)));

  $("notice-text").addEventListener("input", () => { noticeDirty = true; });
  $("notice-save").addEventListener("click", async (e) => {
    const out = await call("set_notice", { notice: $("notice-text").value }, e.currentTarget);
    if (out) { noticeDirty = false; ctx.toast($("notice-text").value.trim() ? "공지를 띄웠어요" : "공지를 지웠어요"); }
  });

  // "Knox ID, 이름, 조" — 쉼표나 탭(엑셀 복사)으로 나뉜 줄을 읽습니다. 머리글 줄은 건너뜁니다.
  function parseRows(text) {
    return text.split(/\r?\n/)
      .map((line) => line.split(/[,\t]/).map((c) => c.trim().replace(/^"|"$/g, "")))
      .filter((c) => c[0] && c[1] && !/knox/i.test(c[0]))
      .map((c) => ({ knox_id: c[0], name: c[1], team_no: (c[2] || "").replace(/[^0-9]/g, "") || null }));
  }
  $("csv-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (file) $("csv").value = await file.text();
    e.target.value = "";
  });
  $("csv-import").addEventListener("click", async (e) => {
    const rows = parseRows($("csv").value);
    if (!rows.length) return ctx.toast("읽을 줄이 없어요. 'Knox ID, 이름, 조' 형식인지 확인해 주세요");
    const replace = $("csv-replace").checked;
    if (replace && !confirm("기존 명단과 석식 투표를 모두 지우고 " + rows.length + "명을 새로 올릴까요?")) return;
    const out = await call("roster_import", { rows, replace }, e.currentTarget);
    if (out) {
      ctx.toast(out.imported + "명을 올렸어요");
      $("csv").value = "";
      $("csv-replace").checked = false;
    }
  });

  $("d-refresh").addEventListener("click", loadRoster);
  $("att-reset").addEventListener("click", async (e) => {
    if (!confirm("출석을 모두 초기화할까요?\n모든 참여자가 로그아웃되어 첫 화면(출석)으로 돌아갑니다. 명단·조·투표는 그대로 둡니다.")) return;
    const out = await call("attendance_reset", {}, e.currentTarget);
    if (out) ctx.toast("출석을 초기화했어요");
  });

  $("d-reset").addEventListener("click", async (e) => {
    if (!confirm("석식 투표를 모두 지울까요?\n되돌릴 수 없어요.")) return;
    const out = await call("dinner_reset", {}, e.currentTarget);
    if (out) ctx.toast("석식 투표를 지웠어요");
  });
  $("d-csv").addEventListener("click", () => {
    const label = { yes: "참석", no: "미참석" };
    const lines = [["이름", "Knox ID", "조", "석식"]].concat(
      roster.participants.slice()
        .sort((a, b) => (a.dinner || "z").localeCompare(b.dinner || "z") || a.name.localeCompare(b.name, "ko"))
        .map((p) => [p.name, p.knox_id, p.team_no == null ? "" : teamName(p.team_no), label[p.dinner] || "미응답"]));
    const csv = "﻿" + lines.map((l) => l.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "석식_참석_명단.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // ── admin.js 와의 연결 ───────────────────────────────────────────
  const demoRoster = () => {
    const names = ["강민서", "김도윤", "김서연", "박지호", "서하준", "이수아", "이준우", "정예린", "최시우", "한지민", "홍길동", "윤채원"];
    return {
      teams: [{ team_no: 1, name: "1조", votable: true }, { team_no: 2, name: "2조", votable: true },
        { team_no: 3, name: "3조", votable: true }, { team_no: 13, name: "Chief Crew", votable: false }],
      participants: names.map((name, i) => ({
        knox_id: "demo.user" + (i + 1), name, team_no: i === 11 ? null : (i % 3) + 1,
        is_preregistered: i !== 11, joined_at: i % 4 === 3 ? null : "2026-01-01T00:00:00Z",
        dinner: i % 4 === 3 ? null : i % 5 === 0 ? "no" : "yes",
        vote: i % 4 === 3 || i === 11 ? null : i % 3 === 0 ? 2 : i % 3 === 1 ? 3 : i % 2 ? 1 : 2,
      })),
    };
  };

  window.WCAdminPlatform = {
    entered(c) {
      ctx = c;
      const session = ctx.getSession();
      ready = "program" in session;
      rosterRev = session.roster_rev;
      if (!ready) {
        $("platform-msg").textContent = "메인 관제·명단·석식 기능을 쓰려면 Supabase SQL Editor에서 supabase/platform.sql 을 먼저 실행해 주세요. (워드클라우드 탭은 지금도 쓸 수 있어요)";
        $("platform-msg").hidden = false;
        showTab("wordcloud");
      }
      // admin.html?tab=roster 처럼 열면 그 탭부터 보여 줍니다.
      const first = new URLSearchParams(location.search).get("tab");
      if (ready && first && $("tab-" + first)) showTab(first);
      render();
      loadRoster();
      // 석식 투표·입장은 실시간 알림이 없어서 15초마다 다시 읽습니다.
      if (!ctx.demo) setInterval(() => { if (!document.hidden) loadRoster(); }, 15000);
    },
    // 세션이 바뀔 때마다 admin.js 가 불러 줍니다.
    changed(session) {
      if (!ctx) return;
      if (ready && session.roster_rev !== rosterRev) {
        rosterRev = session.roster_rev;
        loadRoster();
      }
      render();
    },
    // 미리보기(admin.html?demo=1)용 가짜 서버
    demoApi(action, extra, session) {
      if (!this._demo) {
        this._demo = demoRoster();
        Object.assign(session, { program: "lobby", notice: null, roster_rev: 0 });
      }
      const d = this._demo;
      const person = (id) => d.participants.find((p) => p.knox_id === id);
      if (action === "roster") { /* 그대로 돌려줌 */ }
      else if (action === "set_program") session.program = extra.program;
      else if (action === "set_notice") session.notice = extra.notice.trim() || null;
      else if (action === "participant_update") person(extra.knox_id).team_no = extra.team_no;
      else if (action === "participant_delete") d.participants = d.participants.filter((p) => p.knox_id !== extra.knox_id);
      else if (action === "team_rename") d.teams.find((t) => t.team_no === extra.team_no).name = extra.name;
      else if (action === "dinner_reset") d.participants.forEach((p) => { p.dinner = null; });
      else if (action === "attendance_reset") d.participants.forEach((p) => { p.joined_at = null; });
      else if (action === "teamvote_reset") d.participants.forEach((p) => { p.vote = null; });
      else if (action === "team_votable") {
        d.teams.find((t) => t.team_no === extra.team_no).votable = extra.votable;
        if (!extra.votable) d.participants.forEach((p) => { if (p.vote === extra.team_no) p.vote = null; });
      }
      else if (action === "roster_import") {
        if (extra.replace) d.participants = [];
        extra.rows.forEach((r) => {
          const team_no = r.team_no ? Number(r.team_no) : null;
          if (team_no && !d.teams.some((t) => t.team_no === team_no)) d.teams.push({ team_no, name: team_no + "조" });
          const cur = person(r.knox_id.toLowerCase());
          if (cur) Object.assign(cur, { name: r.name, team_no });
          else d.participants.push({ knox_id: r.knox_id.toLowerCase(), name: r.name, team_no, is_preregistered: true, joined_at: null, dinner: null });
        });
        d.teams.sort((a, b) => a.team_no - b.team_no);
        return { ok: true, imported: extra.rows.length, session: Object.assign({}, session), teams: d.teams, participants: d.participants, teamvote_ready: true };
      } else return null; // 워드클라우드 쪽 동작은 admin.js 가 처리
      return { ok: true, session: Object.assign({}, session), teams: d.teams, participants: d.participants, teamvote_ready: true };
    },
  };
})();
