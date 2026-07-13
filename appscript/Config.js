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
//   GOOGLE_SHEET_TAB_NAME           -- defaults to "Leads". LEGACY only: claims
//                                     made before per-teammate tabs still live
//                                     here and are still read, but nothing new
//                                     is ever written to it -- every export now
//                                     goes to its own "Claimed - <Display Name>"
//                                     tab, created automatically.
//   AUTH_SHEET_ID                  -- a SEPARATE, private spreadsheet holding
//                                     the Users tab. Set this so teammates who
//                                     use the leads sheet can't see passwords.
//                                     If unset, falls back to a "Users" tab in
//                                     the main leads sheet (only safe if that
//                                     sheet is private to you). Also used to
//                                     store in-app Suggestions (see below).
//   SUGGESTIONS_TAB_NAME            -- defaults to "Suggestions". Lives in the
//                                     AUTH_SHEET_ID spreadsheet when that's
//                                     configured (so teammates who all have
//                                     edit access to the leads sheet can't read
//                                     each other's feedback -- only the owner
//                                     can). Falls back to a tab in the main
//                                     leads sheet only if AUTH_SHEET_ID is unset.
//   SUGGESTIONS_NOTIFY_EMAIL        -- defaults to caroline.richards.wiz@gmail.com.
//                                     Every submitted suggestion is emailed here
//                                     (via MailApp, sent as whoever owns/runs the
//                                     Apps Script deployment) in addition to
//                                     being logged to the Suggestions tab above.

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
    suggestionsTabName: function () { return get("SUGGESTIONS_TAB_NAME", "Suggestions"); },
    suggestionNotifyEmail: function () { return get("SUGGESTIONS_NOTIFY_EMAIL", "caroline.richards.wiz@gmail.com"); },
  };
})();
