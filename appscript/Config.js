// Reads settings from Script Properties (Project Settings > Script Properties
// in the Apps Script editor) instead of a .env file -- there is no dotenv here,
// and nothing here should ever be hardcoded into a file that gets committed.
//
// Required property to set before deploying:
//   GOOGLE_SHEET_ID                -- the sheet used as lead log + dedup source
// Optional (feature degrades gracefully if unset, same as the Node version):
//   NPPES_VERSION                  -- defaults to 2.1
//   FOURSQUARE_SERVICE_API_KEY
//   GEMINI_API_KEY
//   GEMINI_MODEL                   -- defaults to gemini-2.5-flash
//   GOOGLE_SHEET_TAB_NAME           -- defaults to "Leads"
//   AUTH_SHEET_ID                  -- a SEPARATE, private spreadsheet holding
//                                     the Users tab. Set this so teammates who
//                                     use the leads sheet can't see passwords.
//                                     If unset, falls back to a "Users" tab in
//                                     the main leads sheet (only safe if that
//                                     sheet is private to you).

var Config = (function () {
  function get(key, fallback) {
    var value = PropertiesService.getScriptProperties().getProperty(key);
    return value || fallback || null;
  }

  return {
    nppesVersion: function () { return get("NPPES_VERSION", "2.1"); },
    foursquareApiKey: function () { return get("FOURSQUARE_SERVICE_API_KEY"); },
    geminiApiKey: function () { return get("GEMINI_API_KEY"); },
    geminiModel: function () { return get("GEMINI_MODEL", "gemini-2.5-flash"); },
    googleSheetId: function () { return get("GOOGLE_SHEET_ID"); },
    googleSheetTabName: function () { return get("GOOGLE_SHEET_TAB_NAME", "Leads"); },
    authSheetId: function () { return get("AUTH_SHEET_ID"); },
  };
})();
