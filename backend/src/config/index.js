import dotenv from "dotenv";

dotenv.config();

const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || "development",
  nppesVersion: process.env.NPPES_VERSION || "2.1",
  foursquareApiKey: process.env.FOURSQUARE_SERVICE_API_KEY || null,
};

export default config;