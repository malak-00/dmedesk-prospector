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
