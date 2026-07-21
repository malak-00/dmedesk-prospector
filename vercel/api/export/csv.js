import { withAuth, sendData, sendError } from "../../lib/http.js";
import { companiesToCsv } from "../../lib/services/csvExport.js";

export default withAuth(async (req, res) => {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const csv = companiesToCsv(req.body?.companies);
  sendData(res, { csv, filename: "leads.csv" });
});
