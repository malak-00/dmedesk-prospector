import { withPublic, sendData, sendError } from "../../lib/http.js";
import { logout } from "../../lib/auth.js";

export default withPublic(async (req, res) => {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const data = await logout(token);
  sendData(res, data);
});
