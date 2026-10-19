// Comments and tags on any lead, claimed or not (sql/049). Team-wide: everyone sees them.
// Comments are append-only. A tag can be removed by whoever added it, or by an admin.
import {
  MAX_TAGS_PER_LEAD, SUGGESTED_TAGS, cleanComment, cleanNpi, cleanTag, isTableMissing, shapeAnnotations, summarize,
} from "../lib/annotations.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const NOT_INSTALLED = "Comments and tags aren't installed yet. Run sql/049_lead_comments_tags.sql in Supabase, then try again.";

function failed(error, what) {
  if (isTableMissing(error)) return httpError(503, NOT_INSTALLED);
  return httpError(500, `Failed to ${what}: ${error.message}`);
}

async function namesFor(supabase, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const res = await supabase.from("app_users").select("id, display_name, username").in("id", unique);
  return new Map((res.data || []).map((u) => [u.id, u.display_name || u.username]));
}

export async function getAnnotations(supabase, npiInput) {
  const npi = cleanNpi(npiInput);
  if (!npi) throw httpError(400, "Send a valid NPI.");
  const [comments, tags] = await Promise.all([
    supabase.from("lead_comments").select("id, user_id, body, created_at").eq("npi", npi).order("created_at", { ascending: false }).limit(30),
    supabase.from("lead_tags").select("user_id, tag, created_at").eq("npi", npi).order("created_at", { ascending: true }).limit(MAX_TAGS_PER_LEAD + 5),
  ]);
  // Not installed is not an error on a read: the card just shows nothing to read yet.
  if (comments.error || tags.error) {
    const error = comments.error || tags.error;
    if (isTableMissing(error)) return { installed: false, comments: [], tags: [], suggested: SUGGESTED_TAGS };
    throw failed(error, "read comments and tags");
  }
  const names = await namesFor(supabase, [...comments.data.map((r) => r.user_id), ...tags.data.map((r) => r.user_id)]);
  return { installed: true, ...shapeAnnotations(comments.data, tags.data, names), suggested: SUGGESTED_TAGS };
}

export async function addComment(supabase, npiInput, textInput, session) {
  const npi = cleanNpi(npiInput);
  if (!npi) throw httpError(400, "Send a valid NPI.");
  const text = cleanComment(textInput);
  if (!text) throw httpError(400, "Write a comment of up to 500 characters.");
  const { data, error } = await supabase.from("lead_comments").insert({ npi, user_id: session.id, body: text }).select("id, user_id, body, created_at").single();
  if (error) throw failed(error, "save the comment");
  return { comment: { id: data.id, by: session.displayName || session.username || "You", byId: data.user_id, at: data.created_at, text: data.body } };
}

export async function addTag(supabase, npiInput, tagInput, session) {
  const npi = cleanNpi(npiInput);
  if (!npi) throw httpError(400, "Send a valid NPI.");
  const tag = cleanTag(tagInput);
  if (!tag) throw httpError(400, "A tag is 1 to 24 letters or numbers.");
  const existing = await supabase.from("lead_tags").select("tag").eq("npi", npi);
  if (existing.error) throw failed(existing.error, "check the tags");
  const have = existing.data || [];
  if (have.some((r) => r.tag === tag)) return { tag, added: false };
  if (have.length >= MAX_TAGS_PER_LEAD) throw httpError(409, `A lead can have up to ${MAX_TAGS_PER_LEAD} tags. Remove one first.`);
  const { error } = await supabase.from("lead_tags").insert({ npi, tag, user_id: session.id });
  if (error && error.code !== "23505") throw failed(error, "save the tag"); // 23505: someone added it a moment ago
  return { tag, added: !error };
}

export async function removeTag(supabase, npiInput, tagInput, session) {
  const npi = cleanNpi(npiInput);
  const tag = cleanTag(tagInput);
  if (!npi || !tag) throw httpError(400, "Send a valid NPI and tag.");
  const found = await supabase.from("lead_tags").select("user_id").eq("npi", npi).eq("tag", tag).maybeSingle();
  if (found.error) throw failed(found.error, "find the tag");
  if (!found.data) return { tag, removed: false };
  if (found.data.user_id !== session.id && !session.isAdmin) throw httpError(403, "Only the person who added a tag, or an admin, can remove it.");
  const { error } = await supabase.from("lead_tags").delete().eq("npi", npi).eq("tag", tag);
  if (error) throw failed(error, "remove the tag");
  return { tag, removed: true };
}

// A page of results: npi -> { tags, comments }. Best-effort for the caller (see companyService).
export async function summaryAmong(supabase, npis) {
  const list = [...new Set((npis || []).map(String).filter(Boolean))];
  if (!list.length) return new Map();
  const [comments, tags] = await Promise.all([
    supabase.from("lead_comments").select("npi, body").in("npi", list),
    supabase.from("lead_tags").select("npi, tag").in("npi", list),
  ]);
  if (comments.error || tags.error) throw failed(comments.error || tags.error, "read comments and tags");
  return summarize(comments.data, tags.data);
}
