// Reads settings from Script Properties (Project Settings > Script Properties
// in the Apps Script editor) instead of a .env file -- there is no dotenv here,
// and nothing here should ever be hardcoded into a file that gets committed.
//
// Required properties to set before deploying:
//   APP_TOKEN                      -- shared secret the frontend must send with every request
//   GOOGLE_SHEET_ID                -- the sheet used as lead log + dedup source
// Optional (feature degrades gracefully if unset, same as the Node version):
//   NPPES_VERSION                  -- defaults to 2.1
//   FOURSQUARE_SERVICE_API_KEY
//   GEMINI_API_KEY
//   GEMINI_MODEL                   -- defaults to gemini-2.5-flash
//   GOOGLE_SHEET_TAB_NAME           -- defaults to "Leads"

var Config = (function () {
  function get(key, fallback) {
    var value = PropertiesService.getScriptProperties().getProperty(key);
    return value || fallback || null;
  }

  return {
    appToken: function () { return get("APP_TOKEN"); },
    nppesVersion: function () { return get("NPPES_VERSION", "2.1"); },
    foursquareApiKey: function () { return get("FOURSQUARE_SERVICE_API_KEY"); },
    geminiApiKey: function () { return get("GEMINI_API_KEY"); },
    geminiModel: function () { return get("GEMINI_MODEL", "gemini-2.5-flash"); },
    googleSheetId: function () { return get("GOOGLE_SHEET_ID"); },
    googleSheetTabName: function () { return get("GOOGLE_SHEET_TAB_NAME", "Leads"); },
  };
})();
