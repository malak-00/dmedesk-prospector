import { withPublic, sendData, sendError } from "../../lib/http.js";
import { login } from "../../lib/auth.js";

export default withPublic(async (req, res) => {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const { email, password } = req.body || {};
  const data = await login(email, password);
  sendData(res, data);
});
