// One short, meaningful list of lead statuses, and the rules that map the many ways people
// have typed them onto it ("VM", "Voice mail", "left vm" -> voicemail). Pure, so it is
// tested on its own and shared by every place a status is written.
//
// "disconnected" is not in the list on purpose: it is a move (the lead leaves the active
// lists), done with Send to Disconnected, not a status to type or merge into.

// What a rep can mark a lead as, in the order they are shown.
export const CALL_RESULTS = ["called", "voicemail", "no answer", "gatekeeper", "callback", "interested", "follow up", "not interested", "do not call"];
// Where a lead is in the pipeline; set by meetings and by hand, not as the result of one call.
export const PIPELINE_STAGES = ["new", "meeting booked", "meeting held", "contract sent", "invoice sent", "onboarded"];
export const CANONICAL_STATUSES = ["new", ...CALL_RESULTS, ...PIPELINE_STAGES.slice(1)];

export const MAX_STATUS_LENGTH = 40;

// Rules, first match wins. Written against the cleaned text (lower case, words separated by single spaces).
const RULES = [
  ["voicemail", /^(vm|vmail|voice ?mail|lvm|left (a )?(vm|voice ?mail|message|msg)|voice ?mail left|left message)$/],
  ["no answer", /^(na|n a|no ans(wer)?|did not answer|didnt answer|did ?n t answer|not answering|no pick ?up|dnp|rang out|no response)$/],
  ["gatekeeper", /^(gk|gate ?keeper|gate keeper|front desk|receptionist|blocked)$/],
  ["callback", /^(cbk|cb|call ?back|call back|callback requested|call back later|requested callback)$/],
  ["follow up", /^(follow ?up.*|f u|fu|following up|nurture|check ?in|touch base)$/],
  ["interested", /^(interested|int|warm|hot|very interested|wants info|send info|info sent)$/],
  ["not interested", /^(ni|not interested|no interest|not int|declined|uninterested|pass|rejected)$/],
  ["do not call", /^(dnc|do not call|don t call|dont call|never call|remove|opt ?out|unsubscribed?)$/],
  ["meeting booked", /^(meeting booked|booked|meeting set|meeting scheduled|appt( set)?|appointment( set| booked)?|scheduled|demo (booked|scheduled|set))$/],
  ["meeting held", /^(meeting held|held|demo (done|held)|met|had meeting)$/],
  ["contract sent", /^(contract sent|contract|sent contract|agreement sent|proposal sent)$/],
  ["invoice sent", /^(invoice sent|invoice|sent invoice|billed)$/],
  ["onboarded", /^(onboarded|onboard|onboarding|signed|signed up|closed won|won|customer|client|active customer|live)$/],
  ["called", /^(called|call|contacted|spoke|spoke to( owner)?|talked|reached|connected|answered|conversation)$/],
  ["new", /^(new|unworked|untouched|fresh|claimed|open|none|n a new)$/],
];

// Lower case, accents and punctuation dropped, hyphens and underscores read as spaces.
export function cleanStatus(raw) {
  return String(raw ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_\-/]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// The canonical status a typed one means, or null when it isn't one we recognise.
export function canonicalStatus(raw) {
  const text = cleanStatus(raw);
  if (!text) return null;
  if (CANONICAL_STATUSES.includes(text)) return text;
  const hit = RULES.find(([, pattern]) => pattern.test(text));
  return hit ? hit[0] : null;
}

// Things that carry no meaning: nothing, a single character, only digits, or obvious placeholders.
const JUNK = /^(test|testing|asdf|asd|qwerty|xx+|zzz+|tbd|todo|temp|misc|other|unknown|n a|na na|idk|\?+|\.+|-+)$/;
export function isJunkStatus(raw) {
  if (canonicalStatus(raw)) return false; // short but meaningful: "ni", "vm", "gk"
  const text = cleanStatus(raw);
  return text.length < 3 || /^\d+$/.test(text) || JUNK.test(text) || /^(.)\1+$/.test(text);
}

// What gets stored when a status is written: the canonical one if it means one, otherwise a
// tidied lower-case version of what was typed, so "Site Visit" and "site  visit" are one status.
export function normalizeStatus(raw) {
  const canonical = canonicalStatus(raw);
  if (canonical) return canonical;
  const text = cleanStatus(raw).slice(0, MAX_STATUS_LENGTH).trim();
  return text;
}

// For the cleanup screen: what this stored spelling should probably become.
export function suggestMerge(raw) {
  const stored = String(raw ?? "").trim();
  const canonical = canonicalStatus(stored);
  if (canonical) return { target: canonical, why: canonical === stored ? "ok" : "same meaning", junk: false };
  if (cleanStatus(stored) === "disconnected") return { target: null, why: "disconnected", junk: false };
  // Nothing to keep: back to "new" (a bare number is usually a spreadsheet date that landed in the status column).
  if (isJunkStatus(stored)) return { target: "new", why: "meaningless", junk: true };
  const tidy = normalizeStatus(stored);
  return { target: tidy !== stored ? tidy : null, why: tidy !== stored ? "tidy spelling" : "custom", junk: false };
}

// Distinct statuses in use, each spelling with its count and what it should become.
export function statusCleanupRows(counts) {
  return [...counts.entries()]
    .filter(([status]) => String(status || "").trim() !== "")
    .map(([status, count]) => ({ status, count, ...suggestMerge(status) }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));
}

// The statuses to offer in dropdowns: the canonical list, then any custom ones still in use
// (one per meaning, so "Voicemail" and "voicemail" are not listed twice).
export function statusOptions(inUse) {
  const seen = new Set(CANONICAL_STATUSES);
  const options = [...CANONICAL_STATUSES];
  for (const raw of inUse) {
    const key = normalizeStatus(raw);
    if (!key || key === "disconnected" || seen.has(key) || isJunkStatus(raw)) continue;
    seen.add(key);
    options.push(key);
  }
  return options;
}
