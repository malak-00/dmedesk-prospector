// Medicare enrollment, from CMS's public provider enrollment file (one row per enrollment). Tells a rep whether the
// supplier is enrolled with Medicare at all, since when, and as what. Pure, so it is tested without the network.
//
// The enrollment id carries the date the enrollment was created: a letter (I individual, O organization) then
// YYYYMMDD and a sequence number ("O20151130001936" is 2015-11-30). Not every id follows that, so a date that does
// not parse is simply left out.

export function enrollmentDate(id) {
  const m = /^[A-Z](\d{4})(\d{2})(\d{2})\d+$/.exec(String(id || "").trim().toUpperCase());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1966 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

const titleCase = (t) => String(t || "").toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (_, a, b) => a + b.toUpperCase()).replace(/\bDme\b/g, "DME").replace(/\bDmepos\b/g, "DMEPOS");

export function buildEnrollment(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return { enrolled: false };
  const dates = list.map((r) => enrollmentDate(r.ENRLMT_ID)).filter(Boolean).sort();
  const types = [...new Set(list.map((r) => String(r.PROVIDER_TYPE_DESC || "").trim()).filter(Boolean))];
  return {
    enrolled: true,
    since: dates[0] || null,
    types: types.map(titleCase).slice(0, 3),
    dme: types.some((t) => /\bDME|DMEPOS|DURABLE/i.test(t)),
    enrollments: list.length,
  };
}
