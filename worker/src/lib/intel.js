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
export function cleanIntel(input = {}, now = Date.now()) {
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
  if ("followUpAt" in input) {
    const day = clean(input.followUpAt);
    if (day) {
      const t = Date.parse(`${day}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(t)) return { error: "That doesn't look like a date." };
      if (t < now - 2 * 86_400_000) return { error: "Pick today or a day in the future." };
      if (t > now + 400 * 86_400_000) return { error: "Pick a date within the next year." };
    }
    patch.follow_up_at = day || null;
  }
  return Object.keys(patch).length ? { patch } : { error: "Nothing to save." };
}

// Row -> what the browser gets.
export function shapeIntel(row, userName) {
  if (!row) return { currentBiller: "", gatekeeper: "", directLine: "", email: "", patientVolume: "", objection: "", followUpAt: "", updatedBy: "", updatedAt: "" };
  return {
    currentBiller: row.current_biller || "",
    gatekeeper: row.gatekeeper || "",
    directLine: row.direct_line || "",
    email: row.email || "",
    patientVolume: row.patient_volume || "",
    objection: row.objection || "",
    followUpAt: row.follow_up_at ? String(row.follow_up_at).slice(0, 10) : "",
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

// "Who we're up against": the billers reps recorded, counted, with the objections that came with them.
// Typed names are grouped by a loose key (case, punctuation and company endings ignored); "in-house" answers
// become one bucket. Most common first, top 10.
const IN_HOUSE = /^(in.?house|inhouse|internal|ourselves|themselves|own staff|their own|self)$/;
const nameKey = (raw) => String(raw || "").toLowerCase().replace(/\b(llc|inc|incorporated|corp|corporation|co|company|ltd|billing|services)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

export function billerCounts(rows, limit = 10) {
  const groups = new Map();
  for (const r of rows || []) {
    const name = String((r && r.current_biller) || "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    const inHouse = IN_HOUSE.test(name.toLowerCase().replace(/[^a-z\- ]/g, "").trim());
    const key = inHouse ? "in-house" : nameKey(name) || name.toLowerCase();
    if (!groups.has(key)) groups.set(key, { key, inHouse, count: 0, names: new Map(), objections: new Map() });
    const g = groups.get(key);
    g.count += 1;
    g.names.set(name, (g.names.get(name) || 0) + 1);
    if (r.objection) g.objections.set(r.objection, (g.objections.get(r.objection) || 0) + 1);
  }
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  return [...groups.values()]
    .map((g) => ({
      name: g.inHouse ? "In-house" : [...g.names.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))[0][0],
      inHouse: g.inHouse,
      count: g.count,
      objections: top(g.objections).slice(0, 2).map(([reason, count]) => ({ reason, count })),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}
