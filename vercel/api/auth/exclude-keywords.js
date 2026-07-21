// Replaces Code.js's "auth/exclude-keywords" route + AuthService.setExcludeKeywords.
import { withAuth, sendData, sendError } from "../../lib/http.js";

const MAX_LENGTH = 500;

export default withAuth(async (req, res) => {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");

  const trimmed = String(req.body?.excludeKeywords || "").trim();
  if (trimmed.length > MAX_LENGTH) return sendError(res, 400, `Exclude keywords must be ${MAX_LENGTH} characters or fewer`);

  const { error } = await req.supabase.from("profiles").update({ exclude_keywords: trimmed }).eq("id", req.user.id);
  if (error) throw error;

  sendData(res, { excludeKeywords: trimmed });
});
