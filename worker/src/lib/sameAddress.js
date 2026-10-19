// "Who else is at this address?" Pure helpers so the matching is tested without a database.
// NPPES writes a suite into the street line ("3065 34TH ST N STE A"), so two offices in one building
// differ only by the suite. The street key drops the suite/unit part; same key + same city, state and
// ZIP5 means the same building.

const UNIT_WORDS = "STE|SUITE|UNIT|APT|APARTMENT|RM|ROOM|FL|FLOOR|BLDG|BUILDING|DEPT|LOT|SPC";

export function streetKey(line1) {
  let s = String(line1 || "").toUpperCase().replace(/[.,]/g, " ");
  s = s.replace(/#.*$/, "");
  s = s.replace(new RegExp(`\\s+(?:${UNIT_WORDS})\\b.*$`), "");
  return s.replace(/\s+/g, " ").trim();
}

// A key worth searching on: long enough, and carries a house number (or box number).
export function usableStreetKey(key) {
  return key.length >= 5 && /\d/.test(key);
}

const zip5 = (z) => String(z || "").replace(/\D/g, "").slice(0, 5);

// me / other: { address_line1, address_postalcode }
export function sameBuilding(me, other) {
  const a = streetKey(me.address_line1);
  if (!usableStreetKey(a) || a !== streetKey(other.address_line1)) return false;
  const za = zip5(me.address_postalcode);
  const zb = zip5(other.address_postalcode);
  return !za || !zb || za === zb;
}

// ilike treats % _ and \ specially; they are plain characters in an address.
export const escapeLike = (s) => String(s).replace(/[\\%_]/g, (ch) => "\\" + ch);

export const MAX_SAME_ADDRESS = 8;

// Active providers only (a missing status is kept: older rows may not carry one).
const isActive = (row) => !row.status || String(row.status).toUpperCase() === "A";

// rows: candidates from the database; claims: Map npi -> { by, status } for leads someone holds
export function buildSameAddress(me, rows, claims = new Map(), excludeNpis = []) {
  const skip = new Set([String(me.npi), ...excludeNpis.map(String)]);
  const matches = (rows || [])
    .filter((r) => !skip.has(String(r.npi)) && isActive(r) && sameBuilding(me, r))
    .map((r) => {
      const claim = claims.get(String(r.npi));
      return {
        npi: String(r.npi),
        name: r.name || "",
        specialty: r.taxonomy_description || "",
        phone: r.phone || "",
        suite: suiteOf(r.address_line1),
        claimedBy: claim ? claim.by || "a teammate" : null,
        status: claim ? claim.status || "" : "",
      };
    });
  return { total: matches.length, matches: matches.slice(0, MAX_SAME_ADDRESS) };
}

// The part of the street line that streetKey drops, e.g. "STE A".
export function suiteOf(line1) {
  const raw = String(line1 || "").toUpperCase().replace(/[.,]/g, " ");
  const m = new RegExp(`(?:#|\\b(?:${UNIT_WORDS})\\b).*$`).exec(raw);
  return m ? m[0].replace(/\s+/g, " ").trim() : "";
}
