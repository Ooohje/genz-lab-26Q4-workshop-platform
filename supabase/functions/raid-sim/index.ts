// Gen Z Lab. 보스 레이드 시뮬레이터 — 진행자 Edge Function (raid-sim.html 전용)
//
// 진행자 버튼(게임 준비, 보스 시작, 마감, 결과 공개 …)은 비밀번호를 확인한 뒤 이 함수가
// 데이터베이스 함수 raid_sim_admin 을 부릅니다. 판정 스탯이 든 상태는 이 함수만 돌려줍니다.
// 워크샵 플랫폼과 같은 Supabase 프로젝트에 배포합니다 (supabase/raid-sim.sql 을 먼저 실행).
//
// 비밀번호 (대시보드 > Edge Functions > Secrets):
//   RAID_SIM_PASSWORD   보스 레이드 진행자 비밀번호. 없으면 플랫폼 관리자 비밀번호 ADMIN_PASSWORD 를 같이 씁니다.
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 는 Supabase가 자동으로 넣어 줍니다.
// 대시보드에서 이 함수의 "Verify JWT"(JWT 확인)는 꺼 둡니다. 비밀번호로 확인합니다.

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

async function sha256(text: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

// 비밀번호 비교: 길이·내용에 따라 걸리는 시간이 달라지지 않게 해시끼리 비교합니다.
async function passwordOk(given: unknown) {
  const expected = Deno.env.get("RAID_SIM_PASSWORD") || Deno.env.get("ADMIN_PASSWORD") || "";
  if (!expected || typeof given !== "string") return false;
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// "명단 불러오기": 워크샵 본 프로젝트의 명단(participants · teams)을 읽어 [{uid, name, team}] 로 돌려줍니다.
// 읽기만 하고 아무것도 바꾸지 않습니다. 진행자 화면이 이 결과를 명단 칸에 채우고, "명단 적용"을 눌러야 반영됩니다.
// 같은 프로젝트의 participants · teams 를 읽습니다(다른 프로젝트에서 읽을 때만 WORKSHOP_SUPABASE_URL · WORKSHOP_SERVICE_ROLE_KEY).
async function importRoster() {
  const url = Deno.env.get("WORKSHOP_SUPABASE_URL") || Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("WORKSHOP_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) {
    return json({ error: "명단을 불러오려면 Edge Function secret WORKSHOP_SUPABASE_URL 과 WORKSHOP_SERVICE_ROLE_KEY 를 먼저 넣어 주세요" }, 500);
  }
  const ws = createClient(url, key, { auth: { persistSession: false } });
  const [teams, people] = await Promise.all([
    ws.from("teams").select("team_no, name").order("team_no"),
    ws.from("participants").select("knox_id, name, team_no").not("team_no", "is", null).order("team_no").order("name"),
  ]);
  for (const r of [teams, people]) {
    if (r.error) return json({ error: "워크샵 명단을 읽지 못했어요: " + r.error.message }, 502);
  }
  const teamName = new Map<number, string>((teams.data ?? []).map((t: { team_no: number; name: string }) => [t.team_no, String(t.name).trim()]));
  const rows = (people.data ?? []).map((p: { knox_id: string; name: string; team_no: number }) => ({
    uid: String(p.knox_id).trim().toLowerCase(),
    name: String(p.name).trim().slice(0, 20),
    team: (teamName.get(p.team_no) || p.team_no + "조").slice(0, 20),
  }));
  return json({ ok: true, rows });
}

// op: state | setup | make | fillChars | share | raid | start(arg=라운드, 0 = 연습) | hint | close | roll | reveal | final | back(이전 단계) | reset | resetSeats
//     saveConfig(data=규칙) | saveBosses(data=보스 배열) | resetBosses | saveRoster(data=명단)   ← "보스·규칙 설정" 탭
const OPS = new Set(["state", "setup", "make", "fillChars", "share", "raid", "start", "hint", "close", "roll", "reveal", "final", "back", "reset", "resetSeats", "saveRoster",
  "saveConfig", "saveBosses", "resetBosses"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST만 지원합니다" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "요청 형식이 올바르지 않습니다" }, 400);
  }

  if (!Deno.env.get("RAID_SIM_PASSWORD") && !Deno.env.get("ADMIN_PASSWORD")) {
    return json({ error: "Edge Function secret ADMIN_PASSWORD(또는 RAID_SIM_PASSWORD)를 먼저 정해 주세요" }, 500);
  }
  if (!(await passwordOk(body.password))) {
    await new Promise((r) => setTimeout(r, 1000)); // 무작위 대입을 느리게
    return json({ error: "비밀번호가 올바르지 않습니다" }, 401);
  }

  const op = String(body.op ?? "state");
  if (op === "importRoster") return await importRoster();
  if (!OPS.has(op)) return json({ error: "알 수 없는 동작이에요" }, 400);
  const arg = Number.isInteger(body.arg) ? body.arg : null;
  // 보스·규칙 저장 내용. 확인은 데이터베이스 함수(raid_sim_check_bosses, raid_sim_check_config)가 합니다.
  const payload = body.data != null && typeof body.data === "object" ? body.data : null;
  if (payload && JSON.stringify(payload).length > 60000) return json({ error: "설정 내용이 너무 길어요" }, 400);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const { data, error } = await db.rpc("raid_sim_admin", { p_op: op, p_arg: arg, p_data: payload });
  if (error) {
    if (/raid_sim_admin/.test(error.message)) {
      return json({ error: "Supabase SQL Editor에서 supabase/raid-sim.sql 을 먼저 실행해 주세요" }, 400);
    }
    return json({ error: error.message }, 500);
  }
  if (!data?.ok) return json({ error: data?.error ?? "처리하지 못했어요" }, 409);
  return json({ ok: true, view: data.view });
});
