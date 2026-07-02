import dotenv from "dotenv";

dotenv.config();

const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || "development",
  nppesVersion: process.env.NPPES_VERSION || "2.1",
  foursquareApiKey: process.env.FOURSQUARE_SERVICE_API_KEY || null,
  geminiApiKey: process.env.GEMINI_API_KEY || null,
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  googleServiceAccountKeyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || null,
  googleSheetId: process.env.GOOGLE_SHEET_ID || null,
  googleSheetTabName: process.env.GOOGLE_SHEET_TAB_NAME || "Leads",
};

export default config;