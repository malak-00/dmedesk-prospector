// Username/password sign-in backed by a "Users" tab in the same Google Sheet
// that stores leads, with sessions held in CacheService (max 6 hours, then the
// user signs in again -- roughly once per workday).
//
// Users tab layout (create it manually):
//   Row 1 (header):  Username | Password | Display Name | Exclude Keywords
//   Row 2+:          one row per teammate
//
// "Exclude Keywords" is optional and free-text (a comma-separated list, e.g.
// "wheelchair, rehab, hospice") -- it's the signed-in user's own persisted
// default for the Prospect search's "exclude keywords" filter, so it follows
// them across sessions/devices instead of resetting every time (see
// setExcludeKeywords below, and NppesService's local exclusion filter).
// Existing Users tabs without this 4th column still work fine -- it just
// reads as an empty string until someone sets it.
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

  // Reads 4 columns even though older Users tabs may only have 3 populated
  // -- Sheets happily returns an empty cell for a column beyond what's been
  // written to, so this is safe and lets "Exclude Keywords" be added to an
  // existing tab at any time without a migration step.
  function getUsers_() {
    var sheet = getUsersSheet_();
    if (!sheet || sheet.getLastRow() < 2) throw AuthNotConfiguredError();

    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
    var users = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r[0] === "" || r[1] === "") continue;
      users.push({
        rowNumber: i + 2,
        username: String(r[0]).trim(),
        password: String(r[1]),
        displayName: String(r[2] || r[0]).trim(),
        excludeKeywords: String(r[3] || "").trim(),
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
    var users = getUsers_();
    var match = null;
    for (var i = 0; i < users.length; i++) {
      if (users[i].username === session.username) { match = users[i]; break; }
    }
    if (!match) {
      var notFound = new Error("User not found");
      notFound.status = 404;
      throw notFound;
    }

    sheet.getRange(match.rowNumber, 4).setValue(trimmed);

    session.excludeKeywords = trimmed;
    CacheService.getScriptCache().put(CACHE_PREFIX + token, JSON.stringify(session), SESSION_TTL_SECONDS);

    return { excludeKeywords: trimmed };
  }

  return { login: login, getSession: getSession, logout: logout, setExcludeKeywords: setExcludeKeywords };
})();
