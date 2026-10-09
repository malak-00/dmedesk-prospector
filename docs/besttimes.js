/* Best times to call: a card on Today that says when a call is most likely to be picked up, from the team's own call history,
   and a score Today uses to put the leads that are in the better half of the day first.
   "Picked up" means someone talked or hung up; voicemail and no answer don't count. Times are the lead's own local time.
   What the data supports is one thing: calls after noon are picked up more often than calls before noon (finer than that, which
   hour or which weekday, is mostly chance, and the card says so rather than inventing a pattern). The card gives that as one
   clear recommendation, shows which time zones are before or after noon right now and when each reaches noon in your own time,
   and keeps the hour-by-hour numbers one click away.
   Loaded after today.js, which asks for cardHtml() each time it draws its side column. */
(function () {
  "use strict";

  const MIN_CELL = 4; // the server uses the same number to decide what counts as enough calls
  const REFRESH_MS = 10 * 60 * 1000;
  const NOON = 12;
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const LONG_DAY = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" };
  const ZONES = [["Eastern", "America/New_York"], ["Central", "America/Chicago"], ["Mountain", "America/Denver"], ["Pacific", "America/Los_Angeles"]];
  let data = null;
  let scope = "team"; // team | mine
  let lastFetch = 0;
  let failed = false;

  const hourLabel = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const clockOf = (date) => date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const joinList = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

  async function load(force) {
    if (!getSession() || (!force && Date.now() - lastFetch < REFRESH_MS)) return;
    lastFetch = Date.now();
    try {
      data = await apiGet("insights/best-times");
      failed = false;
    } catch (err) {
      console.log("[besttimes] " + err.message);
      failed = !data;
    }
    if (window.dmeToday && window.dmeToday.rerender) window.dmeToday.rerender();
  }

  const clear = (blocks) => blocks && blocks.halves && (blocks.halves.verdict === "pm" || blocks.halves.verdict === "am");

  // The view to show: your own calls once they show a clear difference on their own, otherwise the team's.
  function viewFor(which) {
    if (which === "mine" && data.mine && clear(data.mine.blocks)) return { view: data.mine, own: true };
    return { view: data.team, own: false };
  }

  /* ---------- what the card says ---------- */

  function recommendation(halves, overall) {
    const am = Math.round(halves.am.rate * 100);
    const pm = Math.round(halves.pm.rate * 100);
    if (halves.verdict === "pm") {
      return { head: "Call after noon, the lead’s time.", sub: `About <strong>${pm}</strong> of every 100 calls are picked up after noon, against about <strong>${am}</strong> before. That is roughly <strong>${Math.round(halves.lift * 100)}% more</strong> pick-ups for the same number of calls.` };
    }
    if (halves.verdict === "am") {
      return { head: "Call before noon, the lead’s time.", sub: `About <strong>${am}</strong> of every 100 calls are picked up before noon, against about <strong>${pm}</strong> after.` };
    }
    return { head: "Time of day makes little difference so far.", sub: `About <strong>${Math.round(overall * 100)}</strong> of every 100 calls are picked up at any hour, so call whenever the lead is open.` };
  }

  function daysNote(blocks) {
    const strong = blocks.days.filter((d) => d.verdict === "strong").map((d) => LONG_DAY[d.day]);
    const weak = blocks.days.filter((d) => d.verdict === "weak").map((d) => LONG_DAY[d.day]);
    if (!strong.length && !weak.length) return "The day of the week makes no real difference.";
    return [strong.length ? `Better days: ${joinList(strong)}.` : "", weak.length ? `Slower days: ${joinList(weak)}.` : ""].filter(Boolean).join(" ");
  }

  function barsHtml(halves) {
    const rows = [["Before noon", halves.am, halves.verdict === "am"], ["After noon", halves.pm, halves.verdict === "pm"]];
    const max = Math.max(halves.am.rate || 0, halves.pm.rate || 0) * 1.12 || 1;
    return `<div class="bt-bars" aria-label="Share of calls picked up, before and after noon">${rows.map(([label, h, best]) => `
      <div class="bt-bar-row"><span class="bt-bar-label">${label}</span>
        <span class="bt-bar-track" title="about ${Math.round(h.answered)} of ${Math.round(h.calls)} calls picked up"><span class="bt-bar-fill ${best ? "is-strong" : "is-typical"}" style="width:${h.rate ? Math.max(4, (h.rate / max) * 100) : 0}%"></span></span>
        <span class="bt-bar-val">${h.rate === null ? "" : pct(h.rate)}</span></div>`).join("")}</div>`;
  }

  /* ---------- which time zones are past noon right now ---------- */

  function zoneNow(tz) {
    const p = {};
    new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
    const hour = Number(p.hour);
    const minute = Number(p.minute);
    return { day: DAYS.indexOf(p.weekday), hour, minute, clock: `${((hour + 11) % 12) + 1}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}` };
  }

  // When a zone that is still before noon reaches it, on the viewer's own clock.
  function noonInYourTime(now) {
    const minutes = NOON * 60 - (now.hour * 60 + now.minute);
    return clockOf(new Date(Date.now() + minutes * 60 * 1000));
  }

  function zonesHtml(halves) {
    const decisive = halves.verdict === "pm" || halves.verdict === "am";
    const chips = ZONES.map(([name, tz]) => {
      const now = zoneNow(tz);
      if (now.day < 0 || now.hour < 8 || now.hour >= 17) return { rank: 3, html: `<span class="bt-zone is-closed"><b>${name}</b> ${now.clock}<em>Closed</em></span>` };
      const after = now.hour >= NOON;
      const good = decisive && (halves.verdict === "pm" ? after : !after);
      const bad = decisive && !good;
      const text = !decisive ? "Open" : good ? (after ? "After noon · the better half" : "Before noon · the better half") : after ? "After noon · the slower half" : `Before noon · better from ${noonInYourTime(now)} your time`;
      return { rank: good ? 0 : bad ? 2 : 1, html: `<span class="bt-zone is-${good ? "strong" : bad ? "weak" : "typical"}"><b>${name}</b> ${now.clock}<em>${text}</em></span>` };
    }).sort((a, b) => a.rank - b.rank);
    return `<div class="bt-now-label">Right now, by where the lead is</div><div class="bt-zones" id="btZones">${chips.map((c) => c.html).join("")}</div>`;
  }

  // How good a time it is to call a lead right now: the share picked up in the half of the day it is for the lead (0 when it
  // is closed, or the data doesn't separate the halves). Today uses this to put the leads in the better half first.
  function score(stateCode) {
    if (!data || !window.dmeTime || !window.dmeTime.STATE_TO_TZ || !clear(data.team.blocks)) return 0;
    const tz = window.dmeTime.STATE_TO_TZ[String(stateCode || "").trim().toUpperCase()];
    if (!tz) return 0;
    const now = zoneNow(tz);
    if (now.day < 0 || now.hour < 8 || now.hour >= 17) return 0;
    const half = now.hour >= NOON ? data.team.blocks.halves.pm : data.team.blocks.halves.am;
    return half.rate || 0;
  }

  /* ---------- the detail, for anyone who wants it ---------- */

  function hourCell(n, a) {
    if (!n) return '<td class="bt-cell bt-none" title="No calls">·</td>';
    const enough = n >= MIN_CELL;
    return `<td class="bt-cell${enough ? "" : " bt-few"}" style="--r:${(a / n).toFixed(2)}" title="about ${Math.round(a)} of ${Math.round(n)} calls picked up${enough ? "" : " (too few to rely on)"}">${enough ? pct(a / n) : ""}</td>`;
  }

  function detailHtml(view) {
    const rows = view.cells[0].map((_, h) => `<tr><th scope="row">${hourLabel(8 + h)}</th>${DAYS.map((_, d) => hourCell(view.cells[d][h][0], view.cells[d][h][1])).join("")}</tr>`).join("");
    return `<details class="bt-details"><summary>Day by day and hour by hour</summary>
      <p class="bt-days">${escapeHtml(daysNote(view.blocks))}</p>
      <table class="bt-grid" aria-label="Share of calls picked up by weekday and hour"><thead><tr><th></th>${DAYS.map((d) => `<th scope="col">${d}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
      <div class="muted-note">Each square has only a few dozen calls behind it, so single hours and days swing by chance. The only difference the data backs up is before and after noon.</div></details>`;
  }

  /* ---------- the card ---------- */

  function cardHtml() {
    if (!data && !failed) return "";
    // A Worker that hasn't been updated yet sends numbers without the halves; show nothing rather than break Today.
    if (data && !failed && !(data.team && data.team.blocks && data.team.blocks.halves)) return "";
    const body = (() => {
      if (failed) return '<span class="muted-note">Couldn’t load this right now.</span>';
      const { view, own } = viewFor(scope);
      const note = scope === "mine" && !own ? '<div class="muted-note bt-note">Your own calls don’t show a clear difference on their own yet, so this is the team’s picture.</div>' : "";
      if (!view.calls) return '<span class="muted-note">Log calls with a result (voicemail, interested, no answer…) and the best times will show up here.</span>';
      const src = data.sources || {};
      const fromSheet = own ? src.mineSheet : src.sheet;
      const here = Math.max(0, Math.round(view.calls) - Number(fromSheet || 0));
      const sheetNote = fromSheet ? ` ${Number(fromSheet).toLocaleString()} from the earlier calling sheet (the last call on each lead)${here ? ` and ${here.toLocaleString()} logged here` : ""}.` : "";
      const adjusted = !own && src.sheet ? " Adjusted for how each rep logs results." : "";
      const rec = recommendation(view.blocks.halves, view.blocks.overall);
      return `${note}<div class="bt-rec"><div class="bt-rec-head">${escapeHtml(rec.head)}</div><div class="bt-rec-sub">${rec.sub}</div></div>
        ${barsHtml(view.blocks.halves)}${zonesHtml(view.blocks.halves)}${detailHtml(view)}
        <div class="muted-note bt-foot">Based on ${Math.round(view.calls).toLocaleString()} call${Math.round(view.calls) === 1 ? "" : "s"} by the lead’s local time. “Picked up” means someone talked or hung up.${sheetNote}${adjusted}</div>`;
    })();
    const tabs = data && data.mine
      ? `<div class="bt-tabs" role="group" aria-label="Whose calls"><button type="button" class="bt-tab${scope === "team" ? " is-on" : ""}" data-bt="team">Team</button><button type="button" class="bt-tab${scope === "mine" ? " is-on" : ""}" data-bt="mine">Mine</button></div>`
      : "";
    return `<section class="today-card side-card" id="bestTimesCard"><header class="today-card-head"><h3>Best times to call</h3>${tabs}</header><div class="side-body">${body}</div></section>`;
  }

  document.addEventListener("click", (e) => {
    const tab = e.target.closest && e.target.closest("[data-bt]");
    if (!tab) return;
    scope = tab.dataset.bt === "mine" ? "mine" : "team";
    if (window.dmeToday && window.dmeToday.rerender) window.dmeToday.rerender();
  });

  // The "right now" chips follow the clock without redrawing the whole card.
  setInterval(() => {
    const el = document.getElementById("btZones");
    if (!el || !data) return;
    const holder = document.createElement("div");
    holder.innerHTML = zonesHtml(viewFor(scope).view.blocks.halves);
    el.innerHTML = holder.querySelector("#btZones").innerHTML;
  }, 60 * 1000);

  const hooks = window.dmeHooks;
  const previousView = hooks.onView;
  hooks.onView = (view) => { previousView?.(view); if (view === "today") load(false); };
  const previousSignedOut = hooks.onSignedOut;
  hooks.onSignedOut = () => { previousSignedOut?.(); data = null; failed = false; lastFetch = 0; scope = "team"; };

  window.dmeBest = { cardHtml, load, score };
  if (getSession() && state.view === "today") load(true);
})();
