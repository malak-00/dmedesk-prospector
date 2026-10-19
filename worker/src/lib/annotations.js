// Comments and tags on a lead that is not claimed (sql/049). Pure helpers, so the rules are tested
// without a database.

export const MAX_COMMENT = 500;
export const MAX_TAG = 24;
export const MAX_TAGS_PER_LEAD = 12;

// Tags the card offers as one-tap suggestions. Anything else can be typed.
export const SUGGESTED_TAGS = ["good fit", "wheelchair only", "owner reachable", "call after 2pm", "chain", "closed", "wrong specialty"];

export function cleanNpi(raw) {
  const npi = String(raw == null ? "" : raw).trim();
  return /^\d{6,12}$/.test(npi) ? npi : null;
}

// Lower case, single spaces, letters/digits and a few marks; empty means "not a tag".
export function cleanTag(raw) {
  const tag = String(raw == null ? "" : raw)
    .toLowerCase()
    .replace(/[^a-z0-9 +&'./-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return tag.length >= 1 && tag.length <= MAX_TAG ? tag : null;
}

export function cleanComment(raw) {
  const text = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
  return text.length >= 1 && text.length <= MAX_COMMENT ? text : null;
}

// Missing table (sql/049 not run yet): PostgREST says PGRST205 / Postgres 42P01.
export function isTableMissing(error) {
  if (!error) return false;
  return error.code === "PGRST205" || error.code === "42P01" || /could not find the table|does not exist/i.test(error.message || "");
}

// Rows for one lead -> what the card shows. users: Map id -> display name.
export function shapeAnnotations(commentRows, tagRows, users = new Map()) {
  return {
    comments: (commentRows || []).map((r) => ({ id: r.id, by: users.get(r.user_id) || "A teammate", byId: r.user_id, at: r.created_at, text: r.body })),
    tags: (tagRows || []).map((r) => ({ tag: r.tag, by: users.get(r.user_id) || "A teammate", byId: r.user_id, at: r.created_at })),
  };
}

// Many leads at once (a page of search results): npi -> { tags: [..], comments: n }.
export function summarize(commentRows, tagRows) {
  const out = new Map();
  const slot = (npi) => {
    const key = String(npi);
    if (!out.has(key)) out.set(key, { tags: [], comments: 0 });
    return out.get(key);
  };
  (tagRows || []).forEach((r) => slot(r.npi).tags.push(r.tag));
  (commentRows || []).forEach((r) => { slot(r.npi).comments += 1; });
  return out;
}
