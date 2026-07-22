// Consolidated from separate google.js/session.js/logout.js/exclude-keywords.js
// files into one catch-all route -- Vercel's Hobby plan caps a deployment at
// 12 serverless functions, and one file per endpoint (20 total across the
// whole api/ tree) blew past that. A [...action].js file still handles
// every /api/auth/* path, but counts as a single function.
//
// Action is parsed from req.url (see lib/http.js's getActionSegments), not
// Vercel's file-system `req.query` population -- that population isn't
// reliable for plain Vercel Functions without a framework, which is why the
// query-based version 404'd on every action in production.
import { withPublic, sendData, sendError, authenticate, getActionSegments } from "../../lib/http.js";
import { getGoogleSignInUrl, exchangeSession, logout } from "../../lib/auth.js";

const MAX_EXCLUDE_KEYWORDS_LENGTH = 500;

export default withPublic(async (req, res) => {
  const action = getActionSegments(req, "/api/auth/").join("/");

  if (action === "google" && req.method === "GET") {
    const query = new URL(req.url, "http://x").searchParams;
    return sendData(res, await getGoogleSignInUrl(query.get("redirectTo")));
  }

  if (action === "session" && req.method === "POST") {
    const { access_token } = req.body || {};
    return sendData(res, await exchangeSession(access_token));
  }

  if (action === "logout" && req.method === "POST") {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    return sendData(res, await logout(token));
  }

  if (action === "exclude-keywords" && req.method === "POST") {
    const { supabase, user } = await authenticate(req);
    const trimmed = String(req.body?.excludeKeywords || "").trim();
    if (trimmed.length > MAX_EXCLUDE_KEYWORDS_LENGTH) {
      return sendError(res, 400, `Exclude keywords must be ${MAX_EXCLUDE_KEYWORDS_LENGTH} characters or fewer`);
    }
    const { error } = await supabase.from("app_users").update({ exclude_keywords: trimmed }).eq("id", user.id);
    if (error) throw error;
    return sendData(res, { excludeKeywords: trimmed });
  }

  return sendError(res, 404, "Not found");
});
