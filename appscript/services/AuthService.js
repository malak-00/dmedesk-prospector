// Username/password sign-in backed by a "Users" tab in the same Google Sheet
// that stores leads, with sessions held in CacheService (max 6 hours, then the
// user signs in again -- roughly once per workday).
//
// Users tab layout (create it manually):
//   Row 1 (header):  Username | Password | Display Name
//   Row 2+:          one row per teammate
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

  function getUsers_() {
    var sheet = getUsersSheet_();
    if (!sheet || sheet.getLastRow() < 2) throw AuthNotConfiguredError();

    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
    return rows
      .filter(function (r) { return r[0] !== "" && r[1] !== ""; })
      .map(function (r) {
        return {
          username: String(r[0]).trim(),
          password: String(r[1]),
          displayName: String(r[2] || r[0]).trim(),
        };
      });
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
    var session = { username: match.username, displayName: match.displayName };
    CacheService.getScriptCache().put(CACHE_PREFIX + token, JSON.stringify(session), SESSION_TTL_SECONDS);

    return { token: token, username: match.username, displayName: match.displayName };
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

  return { login: login, getSession: getSession, logout: logout };
})();
