/* Callback quick-picks: when "Remind me" lands. Every pick is a real time, and the day-based ones land at 4:00 PM (the start of the
   shift, 3:30 PM to 11:30 PM Cairo time) on the rep's own clock, not 9:00 AM when nobody is calling. "In 2 hours" is for a
   callback the same evening, and "Next Monday" is the Monday after today.
   Pure, so it is tested without a browser (worker/test/remind.test.js). Loaded before app.js; app.js, callmode.js and today.js read it. */
(function (root) {
  "use strict";

  const SHIFT_HOUR = 16;

  // token: "h2" is two hours from now, "mon" is next Monday, a number is that many days from now.
  const CHOICES = [
    { token: "h2", label: "In 2 hours" },
    { token: "1", label: "Tomorrow" },
    { token: "3", label: "3 days" },
    { token: "mon", label: "Next Monday" },
    { token: "7", label: "1 week" },
  ];

  function reminderAt(token, now = new Date()) {
    const t = String(token);
    const d = new Date(now.getTime());
    if (/^h\d+$/.test(t)) {
      d.setTime(now.getTime() + Number(t.slice(1)) * 3600000);
      d.setSeconds(0, 0);
      return d;
    }
    if (t === "mon") d.setDate(d.getDate() + (((1 - d.getDay() + 7) % 7) || 7));
    else d.setDate(d.getDate() + Number(t));
    d.setHours(SHIFT_HOUR, 0, 0, 0);
    return d;
  }

  const iso = (token, now) => reminderAt(token, now).toISOString();

  // "Tue 4:00 PM" for a chip's tooltip, so the exact time is never a guess.
  function describe(token, now) {
    const d = reminderAt(token, now);
    return d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  }

  const api = { CHOICES, SHIFT_HOUR, reminderAt, iso, describe };
  if (typeof module === "object" && module.exports) { module.exports = api; return; }
  root.dmeRemind = api;
})(typeof window !== "undefined" ? window : globalThis);
