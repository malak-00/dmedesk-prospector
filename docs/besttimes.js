/* Best times to call: a small card on Today showing when calls get answered, from the team's own call logs.
   Each square is a weekday and an hour in Cairo time; a darker square means more of the calls logged
   then were answered by a person (anything but voicemail or no answer). Squares with few calls stay faint.
   Loaded after today.js, which asks for cardHtml() each time it draws its side column. */
(function () {
  "use strict";

  const FIRST_HOUR = 14; // the first row is 2 PM Cairo time; the server groups calls the same way
  const MIN_CELL = 4; // the server uses the same number to decide what counts as enough calls
  const REFRESH_MS = 10 * 60 * 1000;
  let data = null;
  let scope = "team"; // team | mine
  let lastFetch = 0;
  let failed = false;

  const hourLabel = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

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

  function cell(n, a) {
    if (!n) return '<td class="bt-cell bt-none" title="No logged calls">·</td>';
    const enough = n >= MIN_CELL;
    const rate = a / n;
    return `<td class="bt-cell${enough ? "" : " bt-few"}" style="--r:${rate.toFixed(2)}" title="${a} of ${n} logged call${n === 1 ? "" : "s"} answered${enough ? "" : " (too few to rely on)"}">${enough ? pct(rate) : ""}</td>`;
  }

  function cardHtml() {
    if (!data && !failed) return "";
    const body = (() => {
      if (failed) return '<span class="muted-note">Couldn’t load this right now.</span>';
      const view = scope === "mine" && data.mine ? data.mine : data.team;
      if (!view.calls) return '<span class="muted-note">Log calls with a result (voicemail, interested, no answer…) and the best times will show up here.</span>';
      const best = view.best.length
        ? `<div class="bt-best">${view.best.map((b) => `<span class="bt-pill"><strong>${b.day} ${hourLabel(b.hour)} Cairo</strong> ${pct(b.answered / b.calls)} answered</span>`).join("")}</div>`
        : '<div class="muted-note">Not enough calls in any one time slot yet to pick a best one.</div>';
      const rows = view.cells[0].map((_, h) => {
        const hour = FIRST_HOUR + h;
        return `<tr><th scope="row">${hourLabel(hour)}</th>${DAYS.map((_, d) => cell(view.cells[d][h][0], view.cells[d][h][1])).join("")}</tr>`;
      }).join("");
      return `${best}
        <table class="bt-grid" aria-label="Share of calls answered by weekday and hour, Cairo time"><thead><tr><th></th>${DAYS.map((d) => `<th scope="col">${d}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
        <div class="muted-note bt-foot">Share of logged calls that reached a person, in Cairo time (calls made during the lead’s business hours). Based on ${view.calls.toLocaleString()} call${view.calls === 1 ? "" : "s"}. Faint squares have fewer than ${MIN_CELL} calls.</div>`;
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

  const hooks = window.dmeHooks;
  const previousView = hooks.onView;
  hooks.onView = (view) => { previousView?.(view); if (view === "today") load(false); };
  const previousSignedOut = hooks.onSignedOut;
  hooks.onSignedOut = () => { previousSignedOut?.(); data = null; failed = false; lastFetch = 0; scope = "team"; };

  window.dmeBest = { cardHtml, load };
  if (getSession() && state.view === "today") load(true);
})();
