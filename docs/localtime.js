/* Local time and "good time to call" for a lead, from its state.
   Each state uses its main time zone (a few states are split; the larger part is used, so a
   lead in the Florida panhandle or west Texas can be an hour off). Calling hours are
   8 AM to 5 PM on weekdays, local to the lead, with the lunch hour (12 to 1) marked as a poor
   time. The calculation is pure (tested in worker/test/localtime.test.js); the rest adds a
   small coloured time to the rows and keeps it current. */
(function (root) {
  "use strict";

  const EASTERN = "America/New_York";
  const CENTRAL = "America/Chicago";
  const MOUNTAIN = "America/Denver";
  const PACIFIC = "America/Los_Angeles";
  const ZONES = {
    [EASTERN]: "CT DE DC FL GA IN KY MA MD ME MI NC NH NJ NY OH PA RI SC VA VT WV",
    [CENTRAL]: "AL AR IA IL KS LA MN MO MS ND NE OK SD TN TX WI",
    [MOUNTAIN]: "CO ID MT NM UT WY",
    "America/Phoenix": "AZ",
    [PACIFIC]: "CA NV OR WA",
    "America/Anchorage": "AK",
    "Pacific/Honolulu": "HI",
    "America/Puerto_Rico": "PR VI",
    "Pacific/Guam": "GU",
  };
  const STATE_TO_TZ = {};
  Object.entries(ZONES).forEach(([zone, list]) => list.split(" ").forEach((s) => { STATE_TO_TZ[s] = zone; }));

  const OPEN_HOUR = 8;
  const LUNCH_START = 12;
  const LUNCH_END = 13;
  const CLOSE_HOUR = 17;
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const formatters = new Map();
  function parts(timeZone, ms) {
    if (!formatters.has(timeZone)) {
      formatters.set(timeZone, new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }));
    }
    const out = {};
    formatters.get(timeZone).formatToParts(new Date(ms)).forEach((p) => { out[p.type] = p.value; });
    return out;
  }
  const clock = (hour, minute) => `${((hour + 11) % 12) + 1}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;

  // -> null for a state we don't know, otherwise { time, abbr, status, good, label }
  //    status: good | lunch | early | late | weekend
  function localInfo(state, nowMs) {
    const tz = STATE_TO_TZ[String(state || "").trim().toUpperCase()];
    if (!tz) return null;
    const p = parts(tz, nowMs === undefined ? Date.now() : nowMs);
    const hour = Number(p.hour);
    const minute = Number(p.minute);
    const weekday = DAYS.indexOf(p.weekday);
    const time = clock(hour, minute);
    const weekend = weekday === 0 || weekday === 6;

    let status;
    let label;
    if (weekend) { status = "weekend"; label = `Weekend there (${time}): opens Mon ${clock(OPEN_HOUR, 0)}`; }
    else if (hour < OPEN_HOUR) { status = "early"; label = `${time} there: opens at ${clock(OPEN_HOUR, 0)}`; }
    else if (hour >= CLOSE_HOUR) { status = "late"; label = `${time} there: closed, opens ${weekday === 5 ? "Mon" : "tomorrow"} ${clock(OPEN_HOUR, 0)}`; }
    else if (hour >= LUNCH_START && hour < LUNCH_END) { status = "lunch"; label = `${time} there: lunch hour, better after ${clock(LUNCH_END, 0)}`; }
    else { status = "good"; label = `${time} there: a good time to call`; }
    return { time, abbr: p.timeZoneName || "", status, good: status === "good", label };
  }

  // The states where a call is sensible right now (used by "Open now").
  function openStates(nowMs) {
    return Object.keys(STATE_TO_TZ).filter((s) => { const i = localInfo(s, nowMs); return i && i.good; });
  }

  const api = { STATE_TO_TZ, localInfo, openStates };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.dmeTime = api;

  /* ---------------- browser wiring ---------------- */
  if (typeof document === "undefined" || !root.dmeHooks) return;

  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // <span class="local-time is-good" data-tz-state="FL">3:42 PM EDT</span>
  root.dmeHooks.localTime = (stateCode) => {
    const info = localInfo(stateCode);
    if (!info) return "";
    return `<span class="local-time is-${info.status}" data-tz-state="${esc(String(stateCode).toUpperCase())}" title="${esc(info.label)}">${esc(info.time)} ${esc(info.abbr)}</span>`;
  };

  // The search form's state list: a dot on every state where a call is sensible right now.
  // Only an indicator: nothing is selected or changed, and every state stays selectable.
  function markStateList() {
    const open = new Set(openStates());
    document.querySelectorAll("#stateOptions .multiselect-option").forEach((el) => {
      const code = el.querySelector("input")?.value;
      const inWindow = Boolean(code && open.has(code));
      el.classList.toggle("in-call-window", inWindow);
      if (inWindow) el.title = "A good time to call here right now"; else el.removeAttribute("title");
    });
  }

  function tick() {
    markStateList();
    document.querySelectorAll("[data-tz-state]").forEach((el) => {
      const info = localInfo(el.dataset.tzState);
      if (!info) return;
      el.className = `local-time is-${info.status}`;
      el.textContent = `${info.time} ${info.abbr}`;
      el.title = info.label;
    });
  }
  setInterval(tick, 60000);
  markStateList();
})(typeof window !== "undefined" ? window : globalThis);
