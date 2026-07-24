// One-off diagnostic route -- see docs/app.js's window.debugFoursquare().
// Makes a single real Foursquare request with a known-good query and
// reports back the raw status/body, to distinguish "not configured" from
// "configured but Foursquare itself is erroring" without needing access to
// Vercel's own function logs.
import { withAuth, sendData, sendError } from "../../lib/http.js";
import { testConnection } from "../../lib/services/foursquareService.js";

export default withAuth(async (req, res) => {
  if (req.method !== "GET") return sendError(res, 405, "Method not allowed");
  sendData(res, await testConnection());
});
