// Who last touched a lead and when, claimed or not: a dial tap, a team note, or a line in a claimed lead's call log.
// Every source is optional (a missing table just contributes nothing), so this never fails a card from opening.
import { cleanNpi } from "../lib/annotations.js";
import { parseNoteLines, noteKind } from "../lib/teamActivity.js";
import { pickLastTouch } from "../lib/lastTouch.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export async function getLastTouch(supabase, npiInput) {
  const npi = cleanNpi(npiInput);
  if (!npi) throw httpError(400, "Send a valid NPI.");
  const [taps, comments, lead] = await Promise.all([
    supabase.from("call_taps").select("user_id, tapped_at").eq("npi", npi).order("tapped_at", { ascending: false }).limit(1),
    supabase.from("lead_comments").select("user_id, created_at").eq("npi", npi).order("created_at", { ascending: false }).limit(1),
    supabase.from("leads").select("claimed_by, notes, status_updated_at, status_updated_by").eq("npi", npi).eq("is_disconnected", false).not("claimed_by", "is", null).limit(1),
  ]);
  const ids = new Set();
  const candidates = [];
  for (const t of (!taps.error && taps.data) || []) { ids.add(t.user_id); candidates.push({ at: Date.parse(t.tapped_at), userId: t.user_id, kind: "dial" }); }
  for (const c of (!comments.error && comments.data) || []) { ids.add(c.user_id); candidates.push({ at: Date.parse(c.created_at), userId: c.user_id, kind: "comment" }); }
  for (const row of (!lead.error && lead.data) || []) {
    if (row.status_updated_at) { ids.add(row.status_updated_by); candidates.push({ at: Date.parse(row.status_updated_at), userId: row.status_updated_by, kind: "status" }); }
    for (const line of parseNoteLines(row.notes)) {
      const kind = noteKind(line.text);
      if (kind === "import") continue;
      candidates.push({ at: Date.parse(`${line.date}T${line.time}:00Z`), by: line.by, kind: kind === "dial" ? "dial" : "note" });
    }
  }
  const real = [...ids].filter(Boolean);
  const names = new Map();
  if (real.length) {
    const users = await supabase.from("app_users").select("id, display_name, username").in("id", real);
    for (const u of (!users.error && users.data) || []) names.set(u.id, u.display_name || u.username);
  }
  return { touch: pickLastTouch(candidates.map((c) => ({ ...c, by: c.by || names.get(c.userId) || "" }))) };
}
