// Reads settings from the Worker's env (Wrangler secrets/vars) instead of
// Apps Script's PropertiesService. Mirrors appscript/Config.js's shape and
// defaults so the rest of the port (ported 1:1 from appscript/services/*)
// can call these the same way.
export function makeConfig(env) {
  const get = (key, fallback) => env[key] || fallback || null;

  return {
    nppesVersion: () => get("NPPES_VERSION", "2.1"),
    // Self-hosted NPPES replica (fakeNPI, github.com/prodbyabdo/fakeNPI) --
    // same request/response shape as the real NPPES API but with no cap on
    // `skip`, backed by our own npi_records table. This is the live source
    // for nppes.js's provider search; FAKENPI_BASE_URL lets it be pointed
    // elsewhere (e.g. back at the real NPPES API) without a code change.
    fakeNpiBaseUrl: () => get("FAKENPI_BASE_URL", "https://zvthhjediuelpvzkkzvy.supabase.co/functions/v1/nppes-search/api/"),
    foursquareApiKey: () => get("FOURSQUARE_SERVICE_API_KEY"),
    geminiApiKey: () => get("GEMINI_API_KEY"),
    geminiModel: () => get("GEMINI_MODEL", "gemini-2.5-flash"),
    jwtSecret: () => get("JWT_SECRET"),
    supabaseUrl: () => get("SUPABASE_URL"),
    supabaseServiceRoleKey: () => get("SUPABASE_SERVICE_ROLE_KEY"),
    // For the optional "Export to Sheet" button (googleSheets.js) -- an
    // OAuth client + refresh token authorized as a real Google account with
    // edit access to googleSheetId(), NOT the same thing as claiming a lead
    // (which writes to Supabase, see leadsRepo.js).
    googleOauthClientId: () => get("GOOGLE_OAUTH_CLIENT_ID"),
    googleOauthClientSecret: () => get("GOOGLE_OAUTH_CLIENT_SECRET"),
    googleOauthRefreshToken: () => get("GOOGLE_OAUTH_REFRESH_TOKEN"),
    googleSheetId: () => get("GOOGLE_SHEET_ID"),
  };
}
