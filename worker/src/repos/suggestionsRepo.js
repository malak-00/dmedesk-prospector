// Replaces appscript/services/SheetsStore.js's Suggestions-tab half with
// the `suggestions` table. The old version also emailed the owner via
// MailApp -- there's no equivalent mail sender wired up here (would need an
// email API like Resend/SendGrid and its own API key), so a submitted
// suggestion is stored but not emailed. `debug/suggestion-email` reports
// that plainly instead of silently pretending to send.
const MAX_SUGGESTION_LENGTH = 2000;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export async function addSuggestion(supabase, text, session) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw httpError(400, "suggestion text is required");
  if (trimmed.length > MAX_SUGGESTION_LENGTH) throw httpError(400, `suggestion must be ${MAX_SUGGESTION_LENGTH} characters or fewer`);

  const now = new Date().toISOString();
  const { error } = await supabase.from("suggestions").insert({ text: trimmed, submitted_by: session.id, created_at: now });
  if (error) throw httpError(500, "Failed to save suggestion: " + error.message);

  return { submittedAt: now };
}

// Admin-only -- caller must check session.isAdmin first (see index.js's
// /admin routes). `submitted_by` doesn't carry a display name of its own,
// so this resolves it via a second query against app_users rather than a
// join, since suggestions is small and this isn't a hot path.
// sql/055 adds done_at / done_by. Before it is run the list still loads, every suggestion simply reads as open.
const missingColumn = (error) => Boolean(error) && (error.code === "42703" || /done_at|done_by|does not exist/i.test(error.message || ""));

export async function listAllSuggestions(supabase) {
  let res = await supabase.from("suggestions").select("id, text, submitted_by, created_at, done_at, done_by").order("created_at", { ascending: false });
  if (res.error && missingColumn(res.error)) res = await supabase.from("suggestions").select("id, text, submitted_by, created_at").order("created_at", { ascending: false });
  const { data, error } = res;
  if (error) throw httpError(500, "Failed to load suggestions: " + error.message);
  const rows = data || [];

  const userIds = [...new Set(rows.flatMap((r) => [r.submitted_by, r.done_by]).filter(Boolean))];
  let namesById = {};
  if (userIds.length > 0) {
    const { data: users, error: usersError } = await supabase.from("app_users").select("id, display_name").in("id", userIds);
    if (usersError) throw httpError(500, "Failed to load suggestion submitters: " + usersError.message);
    namesById = Object.fromEntries((users || []).map((u) => [u.id, u.display_name]));
  }

  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    submittedBy: namesById[r.submitted_by] || "Unknown",
    submittedAt: r.created_at,
    done: Boolean(r.done_at),
    doneAt: r.done_at || null,
    doneBy: r.done_at ? (namesById[r.done_by] || "") : "",
  }));
}

// Admin-only. Marks a suggestion done (or open again). Needs sql/055.
export async function setSuggestionDone(supabase, session, id, done) {
  const key = String(id ?? "").trim();
  if (!key) throw httpError(400, "Say which suggestion");
  const now = new Date().toISOString();
  const { data, error } = await supabase.from("suggestions")
    .update(done ? { done_at: now, done_by: session.id } : { done_at: null, done_by: null })
    .eq("id", key).select("id");
  if (error) {
    if (missingColumn(error)) throw httpError(503, "Marking suggestions done isn't installed yet. Run sql/055_suggestion_done.sql in Supabase, then try again.");
    throw httpError(500, "Failed to update the suggestion: " + error.message);
  }
  if (!data || data.length === 0) throw httpError(404, "That suggestion no longer exists");
  return { id: key, done: Boolean(done), doneAt: done ? now : null, doneBy: done ? session.displayName || "" : "" };
}
