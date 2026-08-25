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
export async function listAllSuggestions(supabase) {
  const { data, error } = await supabase.from("suggestions").select("id, text, submitted_by, created_at").order("created_at", { ascending: false });
  if (error) throw httpError(500, "Failed to load suggestions: " + error.message);
  const rows = data || [];

  const userIds = [...new Set(rows.map((r) => r.submitted_by).filter(Boolean))];
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
  }));
}
