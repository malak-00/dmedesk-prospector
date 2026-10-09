/* Best times to call: a card on Today that says when calls are worth making, from the team's own call history.
   Answer rates sit close together through the day, so instead of a grid of percentages it picks out only the windows that clearly
   stand out (the weekday and the part of the day, in the lead's own local time) as stronger or slower than usual, and says which
   time zones are in a strong, average or slow window right now. The hour-by-hour numbers are one click away.
   Loaded after today.js, which asks for cardHtml() each time it draws its side column. */
(function () {
  "use strict";

  const MIN_CELL = 4; // the server uses the same number to decide what counts as enough calls
  const REFRESH_MS = 10 * 60 * 1000;
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const LONG_DAY = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" };
  const PARTS = [{ from: 8, to: 10 }, { from: 10, to: 12 }, { from: 12, to: 14 }, { from: 14, to: 17 }];
  const ZONES = [["Eastern", "America/New_York"], ["Central", "America/Chicago"], ["Mountain", "America/Denver"], ["Pacific", "America/Los_Angeles"]];
  const VERDICT_TEXT = { strong: "Strong time", typical: "Average", weak: "Slow time", few: "Not enough data" };
  let data = null;
  let scope = "team"; // team | mine
  let lastFetch = 0;
  let failed = false;

  const hourLabel = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;
  const pct = (x) => `${Math.round(x * 100)}%`;
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

  /* ---------- what the card says ---------- */

  // The windows that stand out, in words: "Tue 2–5 PM" for each, strongest first.
  const names = (cells) => cells.map((c) => `${LONG_DAY[c.day]} ${c.part}`);

  function verdictHtml(blocks) {
    const strong = blocks.strong.slice(0, 3);
    const weak = blocks.weak.slice(0, 3);
    if (!strong.length && !weak.length) {
      return `<p class="bt-verdict">Nothing stands out yet: answers are around <strong>${pct(blocks.overall)}</strong> at any time of day. Keep calling when you can.</p>`;
    }
    const parts = [];
    if (strong.length) parts.push(`Best: <strong>${joinList(names(strong))}</strong> (${strong.map((c) => pct(c.rate)).join(", ")} answered).`);
    if (weak.length) parts.push(`Slower: ${joinList(names(weak))} (${weak.map((c) => pct(c.rate)).join(", ")}).`);
    parts.push(`Everything else is about average, <strong>${pct(blocks.overall)}</strong>.`);
    const best = strong[0] || null;
    const worst = weak[0] || null;
    const spread = best && worst
      ? `<div class="bt-spread">In the best window about <strong>${Math.round(best.rate * 100)}</strong> of every 100 calls reach someone, in the slowest about <strong>${Math.round(worst.rate * 100)}</strong>.</div>`
      : "";
    return `<p class="bt-verdict">${parts.join(" ")}</p>${spread}`;
  }

  function mapHtml(blocks) {
    const rows = blocks.cells.map((row, p) => `<tr><th scope="row">${escapeHtml(blocks.parts[p])}</th>${row.map((c) => {
      const label = c.verdict === "few"
        ? "Not enough calls to say"
        : `${LONG_DAY[c.day]} ${c.part}: about ${Math.round(c.rate * 100)} of every 100 calls answered (${Math.round(c.calls)} calls)`;
      const mark = c.verdict === "strong" ? `<span class="bt-mark">▲ ${Math.round(c.rate * 100)}</span>` : c.verdict === "weak" ? `<span class="bt-mark">▼ ${Math.round(c.rate * 100)}</span>` : "";
      return `<td class="bt-block is-${c.verdict}" title="${escapeHtml(label)}">${mark}</td>`;
    }).join("")}</tr>`).join("");
    return `<table class="bt-map" aria-label="Which parts of the week answer more or less than usual"><thead><tr><th></th>${DAYS.map((d) => `<th scope="col">${d}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
      <div class="bt-legend"><span><i class="bt-swatch is-strong"></i>Stronger than usual</span><span><i class="bt-swatch is-weak"></i>Slower than usual</span><span><i class="bt-swatch is-typical"></i>About average</span></div>`;
  }

  /* ---------- which time zones are in a good window right now ---------- */

  function zoneNow(tz) {
    const p = {};
    new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
    const hour = Number(p.hour);
    const minute = Number(p.minute);
    const clock = `${((hour + 11) % 12) + 1}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
    return { day: DAYS.indexOf(p.weekday), hour, clock };
  }

  function zonesHtml(blocks) {
    const chips = ZONES.map(([name, tz]) => {
      const now = zoneNow(tz);
      const part = PARTS.findIndex((x) => now.hour >= x.from && now.hour < x.to);
      if (now.day < 0 || part < 0) return { rank: 3, html: `<span class="bt-zone is-closed"><b>${name}</b> ${now.clock}<em>Closed</em></span>` };
      const v = blocks.cells[part][now.day].verdict;
      return { rank: v === "strong" ? 0 : v === "typical" ? 1 : v === "weak" ? 2 : 1, html: `<span class="bt-zone is-${v}"><b>${name}</b> ${now.clock}<em>${VERDICT_TEXT[v]}</em></span>` };
    }).sort((a, b) => a.rank - b.rank);
    return `<div class="bt-now-label">Right now, by where the lead is</div><div class="bt-zones" id="btZones">${chips.map((c) => c.html).join("")}</div>`;
  }

  /* ---------- the hour-by-hour numbers, for anyone who wants them ---------- */

  function hourCell(n, a) {
    if (!n) return '<td class="bt-cell bt-none" title="No calls">·</td>';
    const enough = n >= MIN_CELL;
    const rate = a / n;
    return `<td class="bt-cell${enough ? "" : " bt-few"}" style="--r:${rate.toFixed(2)}" title="about ${Math.round(a)} of ${Math.round(n)} calls answered${enough ? "" : " (too few to rely on)"}">${enough ? pct(rate) : ""}</td>`;
  }

  function hoursHtml(view) {
    const rows = view.cells[0].map((_, h) => `<tr><th scope="row">${hourLabel(8 + h)}</th>${DAYS.map((_, d) => hourCell(view.cells[d][h][0], view.cells[d][h][1])).join("")}</tr>`).join("");
    return `<details class="bt-details"><summary>Hour by hour</summary>
      <table class="bt-grid" aria-label="Share of calls answered by weekday and hour"><thead><tr><th></th>${DAYS.map((d) => `<th scope="col">${d}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
      <div class="muted-note">Share of calls that reached a person, by the lead’s local time. They are all fairly close, which is why the map above only marks the windows that clearly differ.</div></details>`;
  }

  /* ---------- the card ---------- */

  function cardHtml() {
    if (!data && !failed) return "";
    // A Worker that hasn't been updated yet sends numbers without the windows; show nothing rather than break Today.
    if (data && !failed && !(data.team && data.team.blocks)) return "";
    const body = (() => {
      if (failed) return '<span class="muted-note">Couldn’t load this right now.</span>';
      let view = scope === "mine" && data.mine ? data.mine : data.team;
      let note = "";
      if (scope === "mine" && data.mine && !data.mine.blocks.cells.flat().some((c) => c.verdict !== "few")) {
        view = data.team;
        note = '<div class="muted-note bt-note">Your own calls aren’t enough yet to pick out windows, so this is the team’s picture.</div>';
      }
      if (!view.calls) return '<span class="muted-note">Log calls with a result (voicemail, interested, no answer…) and the best times will show up here.</span>';
      const src = data.sources || {};
      const fromSheet = scope === "mine" && data.mine ? src.mineSheet : src.sheet;
      const here = Math.max(0, Math.round(view.calls) - Number(fromSheet || 0));
      const sheetNote = fromSheet ? ` ${Number(fromSheet).toLocaleString()} from the earlier calling sheet (the last call on each lead)${here ? ` and ${here.toLocaleString()} logged here` : ""}.` : "";
      const adjusted = scope === "team" && src.sheet ? " Adjusted for how each rep logs results." : "";
      return `${note}${verdictHtml(view.blocks)}${mapHtml(view.blocks)}${zonesHtml(view.blocks)}${hoursHtml(view)}
        <div class="muted-note bt-foot">Based on ${Math.round(view.calls).toLocaleString()} call${Math.round(view.calls) === 1 ? "" : "s"}, by the lead’s local time.${sheetNote}${adjusted}</div>`;
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
    const view = scope === "mine" && data.mine && data.mine.blocks.cells.flat().some((c) => c.verdict !== "few") ? data.mine : data.team;
    const holder = document.createElement("div");
    holder.innerHTML = zonesHtml(view.blocks);
    el.innerHTML = holder.querySelector("#btZones").innerHTML;
  }, 60 * 1000);

  const hooks = window.dmeHooks;
  const previousView = hooks.onView;
  hooks.onView = (view) => { previousView?.(view); if (view === "today") load(false); };
  const previousSignedOut = hooks.onSignedOut;
  hooks.onSignedOut = () => { previousSignedOut?.(); data = null; failed = false; lastFetch = 0; scope = "team"; };

  window.dmeBest = { cardHtml, load };
  if (getSession() && state.view === "today") load(true);
})();
