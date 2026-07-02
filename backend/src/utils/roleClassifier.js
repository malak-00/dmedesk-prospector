const ROLE_CATEGORIES = {
  owner: ["owner", "founder", "co-founder", "president", "ceo", "chief executive"],
  executive: ["vice president", " vp ", "cfo", "coo", "chief", "executive director"],
  manager: ["manager", "director", "supervisor", "administrator", "office manager", "practice manager"],
  admin: ["admin", "administrative", "front office", "office coordinator"],
};

export function classifyRole(titleText) {
  if (!titleText) return "unknown";
  const lower = ` ${titleText.toLowerCase()} `;
  for (const [category, keywords] of Object.entries(ROLE_CATEGORIES)) {
    if (keywords.some((k) => lower.includes(k))) return category;
  }
  return "staff";
}

export default { classifyRole, ROLE_CATEGORIES };