// Before someone claims a lead: is it probably the same business as a lead somebody has already claimed?
// Two leads look related when they share a phone number, or have the same owner's name in the same state
// (the same rule the Related businesses chip uses). Pure, so it is tested without a database.

const MAX_PHONE_GROUP = 6; // a number shared by more leads than this is a switchboard, not one business
const MAX_OWNER_GROUP = 8;

export const phoneKey = (v) => {
  const d = String(v || "").replace(/\D/g, "").slice(-10);
  return d.length === 10 && !/^(\d)\1+$/.test(d) ? d : "";
};

export const ownerKey = (v) =>
  String(v || "").toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\b(dr|mr|mrs|ms|md|jr|sr|ii|iii|owner|ceo)\b/g, " ").replace(/\s+/g, " ").trim();

const ownerState = (owner, state) => {
  const o = ownerKey(owner);
  const s = String(state || "").trim().toUpperCase();
  return o.split(" ").length >= 2 && s ? `${o}|${s}` : "";
};

// inputs:  [{ npi, phones: [], owner, state }]  (the leads about to be claimed)
// claimed: [{ npi, name, city, state, phones: [], owner, claimedBy, claimedById, status }]  (leads already claimed)
// me: the signed-in user's id. Returns Map(npi -> up to three related leads, teammates' first).
export function findRelatedClaims(inputs, claimed, me) {
  const byPhone = new Map();
  const byOwner = new Map();
  for (const c of claimed) {
    for (const p of new Set((c.phones || []).map(phoneKey).filter(Boolean))) byPhone.set(p, [...(byPhone.get(p) || []), c]);
    const k = ownerState(c.owner, c.state);
    if (k) byOwner.set(k, [...(byOwner.get(k) || []), c]);
  }
  const out = new Map();
  for (const input of inputs) {
    const npi = String(input.npi);
    const found = new Map(); // claimed npi -> { lead, why: Set }
    const add = (lead, why) => {
      if (String(lead.npi) === npi) return;
      const entry = found.get(lead.npi) || { lead, why: new Set() };
      entry.why.add(why);
      found.set(lead.npi, entry);
    };
    for (const p of new Set((input.phones || []).map(phoneKey).filter(Boolean))) {
      const group = byPhone.get(p) || [];
      if (group.length && group.length <= MAX_PHONE_GROUP) group.forEach((c) => add(c, "same phone"));
    }
    const k = ownerState(input.owner, input.state);
    const owned = k ? byOwner.get(k) || [] : [];
    if (owned.length && owned.length <= MAX_OWNER_GROUP) owned.forEach((c) => add(c, "same owner"));
    const list = [...found.values()]
      .map(({ lead, why }) => ({
        npi: lead.npi, name: lead.name, city: lead.city, state: lead.state, status: lead.status || "",
        claimedBy: lead.claimedBy, mine: Boolean(me) && lead.claimedById === me, why: [...why],
      }))
      .sort((a, b) => Number(a.mine) - Number(b.mine) || b.why.length - a.why.length);
    if (list.length) out.set(npi, list.slice(0, 3));
  }
  return out;
}
