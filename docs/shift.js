/* The shift countdown in the header: "2h 10m left in shift" while it is between 3:30 PM and 11:30 PM Cairo time, and nothing otherwise.
   minutesLeft() is pure and tested (worker/test/shift.test.js); the rest puts a small label in the header and refreshes it each half minute. */
(function (root) {
  "use strict";

  const ZONE = "Africa/Cairo";
  const START = 15 * 60 + 30;
  const END = 23 * 60 + 30;

  function cairoMinutes(now) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const get = (type) => Number((parts.find((p) => p.type === type) || {}).value);
    return get("hour") * 60 + get("minute");
  }

  // Minutes left in today's shift, or null before it starts and after it ends.
  function minutesLeft(now = new Date()) {
    const m = cairoMinutes(now);
    return m >= START && m < END ? END - m : null;
  }

  function label(minutes) {
    if (minutes == null) return "";
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h ? `${h}h ${m}m left in shift` : `${m}m left in shift`;
  }

  const api = { minutesLeft, label, START, END };
  if (typeof module === "object" && module.exports) { module.exports = api; return; }
  root.dmeShift = api;

  const right = document.querySelector(".app-header .header-right");
  if (!right) return;
  const el = document.createElement("span");
  el.className = "shift-left";
  el.hidden = true;
  right.insertBefore(el, right.firstChild);
  function paint() {
    const text = label(minutesLeft());
    el.textContent = text;
    el.hidden = !text;
    el.title = "Your shift ends at 11:30 PM Cairo time";
  }
  paint();
  setInterval(paint, 30 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) paint(); });
})(typeof window !== "undefined" ? window : globalThis);
