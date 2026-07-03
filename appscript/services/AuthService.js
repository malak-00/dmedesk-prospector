// Username/password sign-in backed by a "Users" tab in the same Google Sheet
// that stores leads, with sessions held in CacheService (max 6 hours, then the
// user signs in again -- roughly once per workday).
//
// Users tab layout (create it manually in the sheet):
//   Row 1 (header):  Username | Password | Display Name
//   Row 2+:          one row per teammate
//
// Passwords are stored as plain text in that tab. That is a deliberate
// pragmatic choice for an internal stopgap: the sheet is only readable by
// its owner (teammates use the app, not the sheet), and the owner needs to
// be able to set/reset passwords without a hashing tool. Do not reuse real
// personal passwords here.

var AuthNotConfiguredError = function () {
  var err = new Error("Sign-in is not configured (missing or empty 'Users' tab in the Google Sheet)");
  err.name = "AuthNotConfiguredError";
  return err;
};

var AuthService = (function () {
  var USERS_TAB = "Users";
  var SESSION_TTL_SECONDS = 21600; // 6h -- CacheService's maximum
  var CACHE_PREFIX = "sess_";

  function getUsers_() {
    if (!Config.googleSheetId()) throw AuthNotConfiguredError();
    var spreadsheet = SpreadsheetApp.openById(Config.googleSheetId());
    var sheet = spreadsheet.getSheetByName(USERS_TAB);
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
