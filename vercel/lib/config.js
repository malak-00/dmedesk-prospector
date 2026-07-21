// Reads settings from environment variables (Vercel dashboard, or a local
// .env.local with `vercel dev`) -- the direct Node equivalent of
// appscript/Config.js's PropertiesService reads.

function get(key, fallback) {
  const value = process.env[key];
  return value || fallback || null;
}

const config = {
  supabaseUrl: get("SUPABASE_URL"),
  supabaseServiceRoleKey: get("SUPABASE_SERVICE_ROLE_KEY"),
  // Safe for the browser -- but here it's only ever used server-side, paired
  // with the signed-in user's own access token, so every query still runs
  // as that user for Postgres RLS purposes (see lib/supabaseClient.js).
  supabaseAnonKey: get("SUPABASE_ANON_KEY"),
  nppesVersion: get("NPPES_VERSION", "2.1"),
  foursquareApiKey: get("FOURSQUARE_SERVICE_API_KEY"),
  geminiApiKey: get("GEMINI_API_KEY"),
  geminiModel: get("GEMINI_MODEL", "gemini-2.5-flash"),
  allowedOrigins: get("ALLOWED_ORIGINS", "http://localhost:8080")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

export default config;
