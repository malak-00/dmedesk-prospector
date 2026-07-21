import { withAuth, sendData, sendError } from "../../lib/http.js";
import * as leadsService from "../../lib/services/leadsService.js";

export default withAuth(async (req, res) => {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const { npi, reminderAt } = req.body || {};
  const data = await leadsService.setLeadReminder(req.supabase, req.user.id, npi, reminderAt);
  sendData(res, data);
});
