// The App insights dashboard (super admin only): how the team is using the app, how far
// leads get, where people hit friction, and what to improve next. Built only from what
// the app already records, so it needs no new logging. Pure, so it is tested without a
// database.
//
// Super admins are left out of every team number: that account reviews and tests the app,
// so counting it would make adoption look better than it is.
import { buildFunnel } from "./funnel.js";
import { allCallEvents, noteKind, parseNoteLines, tapsToLines } from "./teamActivity.js";

const DAY_MS = 86_400_000;
const STALE_DAYS = 14;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export function buildInsights({
  users = [], claimEvents = [], taps = [], leads = [], suggestions = [], badNumbers = [], searches = [],
  queues = {}, system = null, days = 28, now = new Date(),
} = {}) {
  const span = Math.min(Math.max(Math.round(Number(days)) || 28, 7), 90);
  const nowMs = now.getTime();
  const sinceMs = nowMs - span * DAY_MS;
  const weekAgo = nowMs - 7 * DAY_MS;

  const superIds = new Set(users.filter((u) => u.is_super_admin).map((u) => u.id));
  const team = users.filter((u) => !u.is_super_admin && !u.disabled_at);
  const nameOf = (u) => u.display_name || u.username || "Unknown";
  const idByName = new Map(team.map((u) => [nameOf(u).trim().toLowerCase(), u.id]));
  const teamLeads = leads.filter((l) => l.claimed_by && !superIds.has(l.claimed_by));
  const worked = teamLeads.filter((l) => !l.is_disconnected && String(l.status || "").trim().toLowerCase() !== "disconnected");

  // ---- usage & adoption ---------------------------------------------------
  const people = new Map(team.map((u) => [u.id, {
    id: u.id, name: nameOf(u), isAdmin: Boolean(u.is_admin),
    claims: 0, dials: 0, calls: 0, searches: 0, openLeads: 0, lastActive: 0,
    weekNow: 0, weekPrev: 0, neverContacted: 0, overdue: 0,
  }]));
  const weekBucket = (person, at) => { if (at >= weekAgo) person.weekNow += 1; else if (at >= weekAgo - 7 * DAY_MS) person.weekPrev += 1; };
  const callAt = [];
  const daily = new Map();
  for (let t = sinceMs; t <= nowMs; t += DAY_MS) daily.set(dayOf(t), { date: dayOf(t), claims: 0, dials: 0, calls: 0 });
  const touch = (person, at) => { if (person && at > person.lastActive) person.lastActive = at; };

  for (const e of claimEvents) {
    const at = Date.parse(e.created_at);
    const person = people.get(e.to_user_id);
    if (!person || !at) continue;
    touch(person, at);
    weekBucket(person, at);
    if (at >= sinceMs) { person.claims += 1; const d = daily.get(dayOf(at)); if (d) d.claims += 1; }
  }

  const entries = teamLeads.map((l) => ({ npi: l.npi, lines: parseNoteLines(l.notes) }));
  const nameOfUserId = (id) => { const u = users.find((x) => x.id === id); return u ? nameOf(u) : ""; };
  const tapLines = tapsToLines(taps.filter((t) => !superIds.has(t.user_id)), nameOfUserId);
  for (const ev of allCallEvents(entries, tapLines)) {
    const person = people.get(idByName.get(String(ev.by || "").trim().toLowerCase()));
    if (!person || !ev.at) continue;
    touch(person, ev.at);
    weekBucket(person, ev.at);
    if (ev.at < sinceMs) continue;
    if (callAt.length < 5000) callAt.push(ev.at);
    const key = ev.kind === "dial" ? "dials" : "calls";
    person[key] += 1;
    const d = daily.get(dayOf(ev.at));
    if (d) d[key] += 1;
  }

  for (const s of searches) {
    const person = people.get(s.user_id);
    if (!person) continue;
    person.searches += 1;
    touch(person, Date.parse(s.updated_at) || 0);
  }
  for (const l of worked) { const p = people.get(l.claimed_by); if (p) p.openLeads += 1; }

  const peopleList = [...people.values()].sort((a, b) => b.lastActive - a.lastActive || a.name.localeCompare(b.name));
  const active7 = peopleList.filter((p) => p.lastActive >= weekAgo);
  const dormant = peopleList.filter((p) => p.lastActive < weekAgo);

  // ---- funnel & stuck leads -----------------------------------------------
  const funnel = buildFunnel({ leads: teamLeads, users, sinceMs: 0 });
  const stuckCutoff = nowMs - STALE_DAYS * DAY_MS;
  const firstTap = new Map();
  for (const t of taps) {
    const at = Date.parse(t.tapped_at);
    if (!t.npi || !at || superIds.has(t.user_id)) continue;
    const key = String(t.npi);
    if (!firstTap.has(key) || at < firstTap.get(key)) firstTap.set(key, at);
  }
  const companyOf = (l) => String(l.company_name || "").trim() || `NPI ${l.npi}`;
  let neverContacted = 0;
  let overdue = 0;
  let noteless = 0;
  const stuck = [];
  const firstCallHours = [];
  for (const l of worked) {
    const lines = parseNoteLines(l.notes);
    const contactAts = lines
      .filter((x) => { const k = noteKind(x.text); return k === "call" || k === "dial"; })
      .map((x) => Date.parse(`${x.date}T${x.time}:00Z`)).filter(Boolean);
    if (firstTap.has(String(l.npi))) contactAts.push(firstTap.get(String(l.npi)));
    const claimedAt = Date.parse(l.claimed_at) || 0;
    const touched = contactAts.length > 0 || (l.status && String(l.status).trim().toLowerCase() !== "new");
    const person = people.get(l.claimed_by);
    if (!touched && claimedAt && claimedAt < stuckCutoff) {
      neverContacted += 1;
      if (person) person.neverContacted += 1;
      stuck.push({ company: companyOf(l), rep: person ? person.name : "", days: Math.floor((nowMs - claimedAt) / DAY_MS) });
    }
    if (!lines.length) noteless += 1;
    if (l.reminder_at && Date.parse(l.reminder_at) < nowMs) { overdue += 1; if (person) person.overdue += 1; }
    if (claimedAt >= sinceMs && contactAts.length) {
      const first = Math.min(...contactAts);
      if (first >= claimedAt) firstCallHours.push((first - claimedAt) / 3_600_000);
    }
  }
  stuck.sort((a, b) => b.days - a.days);
  firstCallHours.sort((a, b) => a - b);
  const claimedInSpan = worked.filter((l) => (Date.parse(l.claimed_at) || 0) >= sinceMs).length;
  const medianOf = (xs) => (xs.length ? (xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2) : null);
  const median = medianOf(firstCallHours);
  const firstCall = {
    claimed: claimedInSpan,
    contacted: firstCallHours.length,
    medianHours: median === null ? null : Math.round(median * 10) / 10,
    within1d: firstCallHours.filter((h) => h <= 24).length,
    within3d: firstCallHours.filter((h) => h <= 72).length,
  };
  const statusCounts = new Map();
  for (const l of worked) {
    const s = String(l.status || "").trim() || "(none)";
    statusCounts.set(s, (statusCounts.get(s) || 0) + 1);
  }
  const statuses = [...statusCounts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 8);

  // ---- friction -----------------------------------------------------------
  const bad = badNumbers.filter((b) => !b.cleared_at);
  const badRecent = bad.filter((b) => Date.parse(b.flagged_at) >= weekAgo).length;
  const disconnected = teamLeads.length - worked.length;
  const recentSuggestions = suggestions.filter((s) => Date.parse(s.created_at) >= weekAgo).length;
  const suggestionList = suggestions.slice(0, 8).map((s) => ({
    text: String(s.text || "").slice(0, 400), by: s.submitted_by_name || "", at: s.created_at,
  }));

  const friction = {
    badNumbers: { open: bad.length, wrong: bad.filter((b) => b.reason === "wrong").length, disconnected: bad.filter((b) => b.reason === "disconnected").length, last7: badRecent },
    disconnected: { count: disconnected, share: pct(disconnected, teamLeads.length) },
    suggestions: { total: suggestions.length, last7: recentSuggestions, recent: suggestionList },
    queues: {
      matchReviews: queues.matchReviews ?? null,
      providerChanges: queues.providerChanges ?? null,
      conflicts: queues.conflicts ?? null,
    },
    neverContacted, overdueCallbacks: overdue, leadsWithoutNotes: noteless,
  };

  // ---- what to look at next, in plain words --------------------------------
  const signals = [];
  const add = (level, text) => signals.push({ level, text });
  if (team.length && dormant.length) {
    add(dormant.length === team.length ? "bad" : "warn", `${plural(dormant.length, "person", "people")} of ${team.length} had no activity in the last 7 days: ${dormant.slice(0, 4).map((p) => p.name).join(", ")}${dormant.length > 4 ? "…" : ""}.`);
  }
  if (worked.length >= 10 && pct(neverContacted, worked.length) >= 20) {
    add("warn", `${pct(neverContacted, worked.length)}% of claimed leads (${neverContacted}) were never contacted ${STALE_DAYS}+ days after claiming. Claiming may be outrunning calling: consider a nudge or a claim limit.`);
  }
  if (funnel.total >= 10 && funnel.stages[1] && funnel.stages[1].ofPrevious < 0.5) {
    add("warn", `Only ${Math.round(funnel.stages[1].ofPrevious * 100)}% of claimed leads reach a first contact.`);
  }
  if (firstCall.contacted >= 5 && firstCall.medianHours !== null && firstCall.medianHours > 48) {
    add("warn", `The median time from claiming a lead to the first call is ${Math.round(firstCall.medianHours)} hours. Faster follow-up usually means more meetings.`);
  }
  if (bad.length && pct(badRecent, bad.length) >= 25) {
    add("info", `${plural(badRecent, "bad number")} flagged this week. Phone data quality is a recurring pain point: check which sources they came from.`);
  }
  if (friction.disconnected.share >= 15) {
    add("info", `${friction.disconnected.share}% of claimed leads ended up disconnected: search filters may be letting low-quality leads through.`);
  }
  if (recentSuggestions) add("info", `${plural(recentSuggestions, "new suggestion")} from the team this week: read them below.`);
  if (system) {
    const down = (system.integrations || []).filter((i) => !i.configured).map((i) => i.label);
    const missing = (system.installed || []).filter((i) => !i.installed).map((i) => i.label);
    if (down.length) add("bad", `Not connected: ${down.join(", ")}.`);
    if (missing.length) add("warn", `Not installed yet: ${missing.join(", ")}.`);
  }
  for (const [key, label] of [["matchReviews", "possible-duplicate reviews"], ["providerChanges", "provider changes"], ["conflicts", "ownership conflicts"]]) {
    const n = queues[key];
    if (typeof n === "number" && n >= 25) add("warn", `${n} ${label} are waiting on an admin.`);
  }
  // ---- notes worth sending, written the way a friendly teammate would say it ----
  const nudges = [];
  const first = (p) => p.name.split(" ")[0];
  for (const p of peopleList) {
    const put = (reason, text) => nudges.push({ userId: p.id, name: p.name, reason, text });
    if (p.lastActive < weekAgo && p.openLeads > 0) {
      put("No activity in 7 days", `Hi ${first(p)}, we haven't seen you in the app this week. Anything getting in the way? Reply here and we'll help.`);
    }
    if (p.neverContacted >= 3) {
      put(`${p.neverContacted} claimed leads never called`, `Hi ${first(p)}, ${p.neverContacted} of your claimed leads haven't had a first call yet. Call Mode on your oldest ones is the quickest way to work through them.`);
    }
    if (p.overdue >= 3) {
      put(`${p.overdue} overdue callbacks`, `Hi ${first(p)}, you have ${p.overdue} callbacks past due. They're waiting on your Today page whenever you're ready.`);
    }
    if (p.weekPrev >= 10 && p.weekNow < p.weekPrev * 0.5) {
      put("Activity dropped by half", `Hi ${first(p)}, things have been quieter than last week. If something in the app is slowing you down, tell us and we'll fix it.`);
    }
    if (p.claims >= 10 && p.dials + p.calls === 0) {
      put("Claims but no calls", `Hi ${first(p)}, you've claimed ${p.claims} leads but we haven't seen any calls yet. Need a hand with the next step?`);
    }
  }

  if (!signals.length) add("good", "Nothing stands out. Usage, follow-through and data health all look normal.");

  return {
    generatedAt: now.toISOString(),
    days: span,
    team: { total: team.length, active7: active7.length, dormant: dormant.map((p) => p.name) },
    adoption: {
      daily: [...daily.values()],
      people: peopleList.map((p) => ({ ...p, lastActive: p.lastActive ? new Date(p.lastActive).toISOString() : null })),
    },
    pipeline: { funnel, statuses, firstCall, stuck: stuck.slice(0, 12), neverContacted, overdueCallbacks: overdue, openLeads: worked.length, staleDays: STALE_DAYS },
    friction,
    nudges,
    callAt,
    system,
    signals,
  };
}
