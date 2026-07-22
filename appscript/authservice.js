// Username/password sign-in backed by a "Users" tab in the same Google Sheet
// that stores leads, with sessions held in CacheService (max 6 hours, then the
// user signs in again -- roughly once per workday).
//
// Users tab layout (create it manually):
//   Row 1 (header):  Username | Password | Display Name
//   Row 2+:          one row per teammate
//
// "Exclude Keywords" is a separate, optional column holding each user's own
// persisted default for the Prospect search's "exclude keywords" filter (a
// comma-separated list, e.g. "wheelchair, rehab, hospice") -- so it follows
// them across sessions/devices instead of resetting every time (see
// setExcludeKeywords below, and NppesService's local exclusion filter).
// Unlike Username/Password/Display Name above, it's found by its HEADER TEXT
// ("Exclude Keywords", case-insensitive), never a fixed column position --
// same "never assume column order" rule SheetsStore.js follows for the leads
// sheet -- and setExcludeKeywords auto-creates that column (appended at the
// far right) the first time anyone ever saves a default, so there's no
// manual setup step to get out of sync with.
//
// WHERE the Users tab lives:
//   - Preferred: a SEPARATE spreadsheet that only you can open, whose ID is
//     set in the AUTH_SHEET_ID script property. Because teammates never have
//     access to that file, the plaintext passwords stay private even though
//     everyone shares the leads sheet. This runs as you, so it can still read
//     it.
//   - Fallback: a "Users" tab in the main leads sheet (used only if
//     AUTH_SHEET_ID is unset). Only safe if the leads sheet is private to
//     you -- anyone who can open that sheet would see the passwords.
//
// Passwords are stored as plain text (the owner needs to set/reset them
// without a hashing tool); keep them app-specific, not reused personal
// passwords.

var AuthNotConfiguredError = function () {
  var err = new Error("Sign-in is not configured (missing or empty 'Users' tab in the Google Sheet)");
  err.name = "AuthNotConfiguredError";
  return err;
};

var AuthService = (function () {
  var USERS_TAB = "Users";
  var SESSION_TTL_SECONDS = 21600; // 6h -- CacheService's maximum
  var CACHE_PREFIX = "sess_";
  var MAX_EXCLUDE_KEYWORDS_LENGTH = 500;
  var EXCLUDE_KEYWORDS_LABEL = "Exclude Keywords";

  function getUsersSheet_() {
    // Prefer the dedicated, owner-only spreadsheet if configured.
    var authSheetId = Config.authSheetId();
    if (authSheetId) {
      var authBook = SpreadsheetApp.openById(authSheetId);
      return authBook.getSheetByName(USERS_TAB) || authBook.getSheets()[0];
    }
    // Fallback: a "Users" tab in the main leads sheet.
    if (!Config.googleSheetId()) throw AuthNotConfiguredError();
    return SpreadsheetApp.openById(Config.googleSheetId()).getSheetByName(USERS_TAB);
  }

  // 0-based map of header label (lowercased) -> column index -- same
  // "find a column by its header text, never a fixed position" pattern
  // SheetsStore.js uses for the leads sheet, so "Exclude Keywords" (or any
  // future column) works regardless of what order the Users tab's columns
  // actually end up in.
  function buildColMap_(sheet) {
    var map = {};
    if (sheet.getLastColumn() === 0) return map;
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    for (var i = 0; i < header.length; i++) {
      var label = String(header[i]).trim().toLowerCase();
      if (label) map[label] = i;
    }
    return map;
  }

  function colIndex_(colMap, label) {
    var i = colMap[label.toLowerCase()];
    return i == null ? -1 : i;
  }

  // Guarantees the "Exclude Keywords" column exists on the Users tab,
  // appending it at the far right (as a real header, findable by
  // buildColMap_) if it isn't there yet -- so the very first time anyone
  // clicks "Save as default", the column gets created automatically instead
  // of requiring a manual spreadsheet edit first. Returns the (possibly
  // freshly-created) column map.
  function ensureExcludeKeywordsColumn_(sheet) {
    var map = buildColMap_(sheet);
    if (colIndex_(map, EXCLUDE_KEYWORDS_LABEL) >= 0) return map;
    var col = sheet.getLastColumn() + 1;
    sheet.getRange(1, col, 1, 1).setValues([[EXCLUDE_KEYWORDS_LABEL]]);
    return buildColMap_(sheet);
  }

  // Username/Password/Display Name stay fixed-position (columns 1-3, as
  // documented above) -- only Exclude Keywords is looked up by header label,
  // since it's the one column that may or may not exist yet on any given
  // Users tab.
  function getUsers_() {
    var sheet = getUsersSheet_();
    if (!sheet || sheet.getLastRow() < 2) throw AuthNotConfiguredError();

    var excludeCol = colIndex_(buildColMap_(sheet), EXCLUDE_KEYWORDS_LABEL); // -1 if the column doesn't exist yet
    var width = Math.max(sheet.getLastColumn(), 3);
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
    var users = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r[0] === "" || r[1] === "") continue;
      users.push({
        rowNumber: i + 2,
        username: String(r[0]).trim(),
        password: String(r[1]),
        displayName: String(r[2] || r[0]).trim(),
        excludeKeywords: excludeCol >= 0 ? String(r[excludeCol] || "").trim() : "",
      });
    }
    return users;
  }

  // Compare via SHA-256 digests so the comparison itself doesn't leak
  // length/prefix timing. (The store is plaintext; this hardens only the
  // comparison, which is the cheap part to get right.)
  function secureEquals_(a, b) {
    var da = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, a, Utilities.Charset.UTF_8);
    var db = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, b, Utilities.Charset.UTF_8);
    var diff = 0;
    for (var i = 0; i < da.length; i++) diff |= (da[i] ^ db[i]);
    return diff === 0;
  }

  function login(username, password) {
    if (!username || !password) {
      var missing = new Error("Username and password are required");
      missing.status = 400;
      throw missing;
    }

    var users = getUsers_();
    var match = null;
    for (var i = 0; i < users.length; i++) {
      if (users[i].username.toLowerCase() === String(username).trim().toLowerCase()) {
        match = users[i];
        break;
      }
    }

    if (!match || !secureEquals_(String(password), match.password)) {
      Utilities.sleep(400); // slow down brute-force attempts a little
      var bad = new Error("Wrong username or password");
      bad.status = 401;
      throw bad;
    }

    var token = Utilities.getUuid() + "-" + Utilities.getUuid();
    var session = { username: match.username, displayName: match.displayName, excludeKeywords: match.excludeKeywords };
    CacheService.getScriptCache().put(CACHE_PREFIX + token, JSON.stringify(session), SESSION_TTL_SECONDS);

    return { token: token, username: match.username, displayName: match.displayName, excludeKeywords: match.excludeKeywords };
  }

  function getSession(token) {
    if (!token) return null;
    var raw = CacheService.getScriptCache().get(CACHE_PREFIX + token);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function logout(token) {
    if (token) CacheService.getScriptCache().remove(CACHE_PREFIX + token);
    return { signedOut: true };
  }

  // Persists the signed-in user's default "exclude keywords" search filter
  // to their row in the Users tab (so it follows them to any device/browser
  // next time they sign in), and refreshes it in their CURRENT session cache
  // too, so getSession() reflects the change immediately without requiring
  // a fresh login.
  function setExcludeKeywords(token, text) {
    var session = getSession(token);
    if (!session) {
      var unauthorized = new Error("Not signed in (or session expired)");
      unauthorized.status = 401;
      throw unauthorized;
    }

    var trimmed = String(text || "").trim();
    if (trimmed.length > MAX_EXCLUDE_KEYWORDS_LENGTH) {
      var tooLong = new Error("Exclude keywords must be " + MAX_EXCLUDE_KEYWORDS_LENGTH + " characters or fewer");
      tooLong.status = 400;
      throw tooLong;
    }

    var sheet = getUsersSheet_();
    var colMap = ensureExcludeKeywordsColumn_(sheet); // creates the column if this is the first time anyone's saved one
    var excludeCol = colIndex_(colMap, EXCLUDE_KEYWORDS_LABEL);

    var users = getUsers_(); // re-read AFTER ensuring the column, so rowNumbers/excludeKeywords line up with the (possibly just-created) column
    var match = null;
    for (var i = 0; i < users.length; i++) {
      if (users[i].username === session.username) { match = users[i]; break; }
    }
    if (!match) {
      var notFound = new Error("User not found");
      notFound.status = 404;
      throw notFound;
    }

    sheet.getRange(match.rowNumber, excludeCol + 1).setValue(trimmed);

    session.excludeKeywords = trimmed;
    CacheService.getScriptCache().put(CACHE_PREFIX + token, JSON.stringify(session), SESSION_TTL_SECONDS);

    return { excludeKeywords: trimmed };
  }

  return { login: login, getSession: getSession, logout: logout, setExcludeKeywords: setExcludeKeywords };
})();