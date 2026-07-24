// Replaces Code.js's "suggestions/submit" route. No Sheet/sheetUrl concept
// anymore -- suggestions just land in the `suggestions` table (see
// supabase/migrations/0001_init.sql); read them via the Supabase table
// editor.
import { withAuth, sendData, sendError } from "../../lib/http.js";

const MAX_LENGTH = 2000;

export default withAuth(async (req, res) => {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");

  const text = String(req.body?.text || "").trim();
  if (!text) return sendError(res, 400, "Suggestion text is required");
  if (text.length > MAX_LENGTH) return sendError(res, 400, `Suggestion must be ${MAX_LENGTH} characters or fewer`);

  const { error } = await req.supabase.from("suggestions").insert({ text, submitted_by: req.user.id });
  if (error) throw error;

  sendData(res, { submitted: true });
});
