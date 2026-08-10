// Reads settings from the Worker's env (Wrangler secrets/vars) instead of
// Apps Script's PropertiesService. Mirrors appscript/Config.js's shape and
// defaults so the rest of the port (ported 1:1 from appscript/services/*)
// can call these the same way.
export function makeConfig(env) {
  const get = (key, fallback) => env[key] || fallback || null;

  return {
    nppesVersion: () => get("NPPES_VERSION", "2.1"),
    foursquareApiKey: () => get("FOURSQUARE_SERVICE_API_KEY"),
    geminiApiKey: () => get("GEMINI_API_KEY"),
    geminiModel: () => get("GEMINI_MODEL", "gemini-2.5-flash"),
    jwtSecret: () => get("JWT_SECRET"),
    supabaseUrl: () => get("SUPABASE_URL"),
    supabaseServiceRoleKey: () => get("SUPABASE_SERVICE_ROLE_KEY"),
  };
}
