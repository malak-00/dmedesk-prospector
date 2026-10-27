// The most recent time anyone on the team touched a lead, for the Prospect card ("Last touched Oct 3 by Ana").
// Pure: the repo gathers the candidates, this picks the newest. A candidate is { at (ms), by, kind }.
const KIND_TEXT = { dial: "dialed the number", note: "left a note", call: "logged a call", comment: "left a team note", status: "changed the status" };

export function pickLastTouch(candidates) {
  const best = (candidates || []).filter((c) => c && Number.isFinite(c.at) && c.at > 0).sort((a, b) => b.at - a.at)[0];
  if (!best) return null;
  return { at: new Date(best.at).toISOString(), by: best.by || "", kind: best.kind, text: KIND_TEXT[best.kind] || "touched it" };
}
