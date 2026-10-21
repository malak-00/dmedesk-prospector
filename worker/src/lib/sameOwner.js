// "Does this owner have other businesses?" Pure helpers so the matching is tested without a database.
// The authorized official on an NPI-2 record is usually the owner. The same first and last name on another record
// is only worth showing when it is also in the same state, or the official's phone matches: a common name across the
// country would otherwise match strangers. If a name matches too many records in the state and nothing else backs
// it up, it is treated as ambiguous and nothing is shown.

export const MAX_SAME_STATE = 12;
export const MAX_SHOWN = 8;

export const digits = (v) => String(v || "").replace(/\D/g, "").slice(-10);

// A name worth searching on: both parts at least two letters.
export function ownerName(first, last) {
  const f = String(first || "").trim();
  const l = String(last || "").trim();
  return f.length >= 2 && l.length >= 2 ? { first: f, last: l } : null;
}

const isActive = (row) => !row.status || String(row.status).toUpperCase() === "A";

// me: { npi, state, officialPhone }; rows: candidates sharing the name; claims: Map npi -> { by, status }
export function buildSameOwner(me, rows, claims = new Map(), excludeNpis = []) {
  const skip = new Set([String(me.npi), ...excludeNpis.map(String)]);
  const myPhone = digits(me.officialPhone);
  const candidates = (rows || []).filter((r) => !skip.has(String(r.npi)) && isActive(r)).map((r) => ({
    row: r,
    samePhone: Boolean(myPhone) && digits(r.authorizedofficial_phone) === myPhone,
    sameState: Boolean(me.state) && String(r.address_state || "").toUpperCase() === String(me.state).toUpperCase(),
  }));
  const strong = candidates.filter((c) => c.samePhone);
  const local = candidates.filter((c) => c.sameState && !c.samePhone);
  if (!strong.length && local.length > MAX_SAME_STATE) return { total: 0, ambiguous: true, matches: [] };
  const picked = [...strong, ...local];
  const matches = picked.map(({ row, samePhone }) => {
    const claim = claims.get(String(row.npi));
    return {
      npi: String(row.npi),
      name: row.name || "",
      city: row.address_city || "",
      state: row.address_state || "",
      specialty: row.taxonomy_description || "",
      phone: row.phone || "",
      why: samePhone ? "same owner phone" : "same owner name, same state",
      claimedBy: claim ? claim.by || "a teammate" : null,
    };
  });
  return { total: matches.length, ambiguous: false, matches: matches.slice(0, MAX_SHOWN) };
}
