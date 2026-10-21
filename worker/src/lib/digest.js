// The weekly digest a super admin gets as an avatar note every Monday: last week's numbers against the week before,
// what is worth a look, and what is waiting. Pure, so it is tested without a database. Kept short: notes hold 500 characters.

const sum = (list, key) => (list || []).reduce((n, d) => n + (Number(d[key]) || 0), 0);

// last7 / prev7: the two most recent full weeks of the insights "daily" series, newest last.
export function weekTotals(daily) {
  const list = (daily || []).slice(-14);
  const last = list.slice(-7);
  const prev = list.slice(0, Math.max(0, list.length - 7));
  const calls = (days) => sum(days, "dials") + sum(days, "calls");
  return { calls: calls(last), callsPrev: calls(prev), claims: sum(last, "claims"), claimsPrev: sum(prev, "claims"), hasPrev: prev.length >= 7 };
}

const change = (now, before, hasPrev) => {
  if (!hasPrev) return "";
  const diff = now - before;
  return diff === 0 ? " (same as the week before)" : ` (${diff > 0 ? "+" : "\u2212"}${Math.abs(diff)} on the week before)`;
};

export function buildDigest(insights) {
  const d = insights || {};
  const w = weekTotals(d.adoption && d.adoption.daily);
  const fr = d.friction || {};
  const q = fr.queues || {};
  const parts = [`Weekly digest: ${w.calls} calls${change(w.calls, w.callsPrev, w.hasPrev)}, ${w.claims} claims${change(w.claims, w.claimsPrev, w.hasPrev)}.`];
  if (d.team) parts.push(`${d.team.active7} of ${d.team.total} reps active.`);
  const signals = (d.signals || []).filter((s) => s.level === "bad" || s.level === "warn").slice(0, 2).map((s) => s.text);
  if (signals.length) parts.push(`Worth a look: ${signals.join(" ")}`);
  const waiting = [["possible duplicates", q.matchReviews], ["provider changes", q.providerChanges], ["suggestions this week", fr.suggestions && fr.suggestions.last7]]
    .filter(([, n]) => typeof n === "number" && n > 0).map(([label, n]) => `${n} ${label}`);
  if (waiting.length) parts.push(`Waiting on you: ${waiting.join(", ")}.`);
  let text = parts.join(" ");
  if (text.length > 480) text = text.slice(0, 477).replace(/\s+\S*$/, "") + "\u2026";
  return text;
}
