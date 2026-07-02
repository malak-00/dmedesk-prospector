// Apps Script has no ES modules -- every file in the project shares one global
// scope, so each module is exposed as a single namespaced object instead of
// import/export. This is a 1:1 port of backend/src/utils/roleClassifier.js.

var RoleClassifier = (function () {
  var ROLE_CATEGORIES = {
    owner: ["owner", "founder", "co-founder", "president", "ceo", "chief executive"],
    executive: ["vice president", " vp ", "cfo", "coo", "chief", "executive director"],
    manager: ["manager", "director", "supervisor", "administrator", "office manager", "practice manager"],
    admin: ["admin", "administrative", "front office", "office coordinator"],
  };

  function classifyRole(titleText) {
    if (!titleText) return "unknown";
    var lower = " " + titleText.toLowerCase() + " ";
    for (var category in ROLE_CATEGORIES) {
      var keywords = ROLE_CATEGORIES[category];
      for (var i = 0; i < keywords.length; i++) {
        if (lower.indexOf(keywords[i]) !== -1) return category;
      }
    }
    return "staff";
  }

  return {
    classifyRole: classifyRole,
    ROLE_CATEGORIES: ROLE_CATEGORIES,
  };
})();
