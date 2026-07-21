// Replaces Code.js's "export/disconnected" route +
// SheetsStore.exportCompaniesToDisconnected -- sends leads STRAIGHT to
// disconnected without ever being claimed (used from the Prospect view).
import { withAuth, sendData, sendError } from "../../lib/http.js";
import * as leadsService from "../../lib/services/leadsService.js";
import { flattenCompany } from "../../lib/services/csvExport.js";

export default withAuth(async (req, res) => {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const data = await leadsService.disconnectNewCompanies(req.supabase, req.user.id, req.body?.companies, flattenCompany);
  sendData(res, data);
});
