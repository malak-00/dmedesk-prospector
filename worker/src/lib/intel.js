// Structured call fields on a lead (sql/050): what a rep learns on a call, kept in a form the team can reuse.
// Pure helpers, so the rules are tested without a database.

export const OBJECTIONS = ["price", "in-house", "happy with current", "bad timing", "not the decision maker", "no need", "other"];

export const TEXT_FIELDS = {
  current_biller: 80,
  gatekeeper: 80,
  direct_line: 30,
  email: 120,
  patient_volume: 60,
};

const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

// Accepts the fields a rep changed (camelCase from the browser) and returns { patch } with only valid, trimmed
// values (an empty string clears a field), or { error } for the first bad one. Unknown keys are ignored.
export function cleanIntel(input = {}) {
  const map = { currentBiller: "current_biller", gatekeeper: "gatekeeper", directLine: "direct_line", email: "email", patientVolume: "patient_volume", objection: "objection" };
  const patch = {};
  for (const [key, column] of Object.entries(map)) {
    if (!(key in input)) continue;
    const value = clean(input[key]);
    if (column === "objection") {
      if (value && !OBJECTIONS.includes(value.toLowerCase())) return { error: "Pick one of the listed reasons." };
      patch.objection = value ? value.toLowerCase() : null;
      continue;
    }
    if (value.length > TEXT_FIELDS[column]) return { error: `${key} can be up to ${TEXT_FIELDS[column]} characters.` };
    if (column === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { error: "That doesn't look like an email address." };
    if (column === "direct_line" && value && !/^[\d\s().+\-x#]{7,30}$/i.test(value)) return { error: "That doesn't look like a phone number." };
    patch[column] = value || null;
  }
  return Object.keys(patch).length ? { patch } : { error: "Nothing to save." };
}

// Row -> what the browser gets.
export function shapeIntel(row, userName) {
  if (!row) return { currentBiller: "", gatekeeper: "", directLine: "", email: "", patientVolume: "", objection: "", updatedBy: "", updatedAt: "" };
  return {
    currentBiller: row.current_biller || "",
    gatekeeper: row.gatekeeper || "",
    directLine: row.direct_line || "",
    email: row.email || "",
    patientVolume: row.patient_volume || "",
    objection: row.objection || "",
    updatedBy: userName || "",
    updatedAt: row.updated_at || "",
  };
}

// For the insights page: how many leads gave each reason for saying no, most common first.
export function objectionCounts(rows) {
  const counts = new Map();
  for (const r of rows || []) {
    if (r && r.objection) counts.set(r.objection, (counts.get(r.objection) || 0) + 1);
  }
  return [...counts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}
