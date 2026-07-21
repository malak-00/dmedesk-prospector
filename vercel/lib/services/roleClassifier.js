// 1:1 port of appscript/services/RoleClassifier.js (itself a port of
// backend/src/utils/roleClassifier.js) -- pure logic, no I/O.

export const ROLE_CATEGORIES = {
  owner: ["owner", "founder", "co-founder", "president", "ceo", "chief executive"],
  executive: ["vice president", " vp ", "cfo", "coo", "chief", "executive director"],
  manager: ["manager", "director", "supervisor", "administrator", "office manager", "practice manager"],
  admin: ["admin", "administrative", "front office", "office coordinator"],
};

export function classifyRole(titleText) {
  if (!titleText) return "unknown";
  const lower = ` ${titleText.toLowerCase()} `;
  for (const category of Object.keys(ROLE_CATEGORIES)) {
    for (const keyword of ROLE_CATEGORIES[category]) {
      if (lower.includes(keyword)) return category;
    }
  }
  return "staff";
}

export default { classifyRole, ROLE_CATEGORIES };
