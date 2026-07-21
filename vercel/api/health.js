import { withPublic, sendData } from "../lib/http.js";

export default withPublic(async (req, res) => {
  sendData(res, { name: "DME Desk Prospector (Vercel + Supabase)", status: "running" });
});
