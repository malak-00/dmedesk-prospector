/* Small holiday decorations (and the dates Caro dresses up for). Around each holiday a short string of little ornaments hangs in the empty middle of the
   header, between the logo and your name. It can't cover anything: it only uses space that is otherwise empty, never
   takes clicks, shrinks to nothing when the header needs the room, and is hidden on narrow screens. Anyone can switch
   it off from Caro's panel. Add ?holiday=halloween (or any key below) to the address to preview one.
   holidayFor(date) is pure and tested (worker/test/holidays.test.js); the rest draws the strip. */
(function (root) {
  "use strict";

  const pad = (n) => String(n).padStart(2, "0");
  const dayNumber = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);

  // Western Easter Sunday (the anonymous Gregorian algorithm), as { m, d }.
  function easter(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return { m: month, d: day };
  }

  // Orthodox (Coptic) Easter Sunday in the Gregorian calendar (the Julian rule, 13 days on), as { m, d }.
  function orthodoxEaster(year) {
    const a = year % 4;
    const b = year % 7;
    const c = year % 19;
    const d = (19 * c + 15) % 30;
    const e = (2 * a + 4 * b - d + 34) % 7;
    const month = Math.floor((d + e + 114) / 31);
    const day = ((d + e + 114) % 31) + 1;
    const gregorian = new Date(year, month - 1, day + 13);
    return { m: gregorian.getMonth() + 1, d: gregorian.getDate() };
  }

  const shifted = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);

  // Day of the Islamic (Umm al-Qura) calendar for a local date, or null where the browser has no such calendar.
  function hijri(date) {
    try {
      const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { month: "numeric", day: "numeric" }).formatToParts(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12));
      const month = Number((parts.find((p) => p.type === "month") || {}).value);
      const day = Number((parts.find((p) => p.type === "day") || {}).value);
      return Number.isFinite(month) && Number.isFinite(day) ? { month, day } : null;
    } catch { return null; }
  }

  // Is a given Islamic date (month, day) within `span` days of this date?
  function hijriNear(date, month, day, span) {
    for (let k = -span; k <= span; k += 1) {
      const h = hijri(shifted(date, k));
      if (h && h.month === month && h.day === day) return true;
    }
    return false;
  }

  const KEYS = ["eid", "ramadan", "armedforces", "jan25", "sinai", "june30", "july23", "labour", "shamelnessim", "hijri", "mawlid", "easter", "christmas", "newyear", "halloween", "thanksgiving", "july4", "valentine", "stpatrick", "mothers"];

  // Which holiday (if any) the decorations should show for this date. Earlier in KEYS wins when two overlap.
  function holidayFor(date) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const today = dayNumber(y, m, d);
    const inRange = (m1, d1, m2, d2) => { const a = dayNumber(y, m1, d1); const b = dayNumber(y, m2, d2); return a <= b ? today >= a && today <= b : today >= a || today <= b; };

    const h = hijri(date);
    if (h && ((h.month === 10 && h.day <= 3) || (h.month === 12 && h.day >= 9 && h.day <= 13))) return "eid";
    if (h && h.month === 9) return "ramadan";

    // Egypt's national days and feasts: the whole week around each (three days either side).
    const week = (m1, d1) => Math.abs(today - dayNumber(y, m1, d1)) <= 3;
    if (week(10, 6)) return "armedforces"; // 6th of October, Armed Forces Day
    if (week(1, 25)) return "jan25"; // 25 January Revolution and Police Day
    if (week(4, 25)) return "sinai"; // Sinai Liberation Day
    if (week(6, 30)) return "june30"; // 30 June Revolution
    if (week(7, 23)) return "july23"; // 23 July Revolution Day
    if (week(5, 1)) return "labour"; // Labour Day
    const o = orthodoxEaster(y);
    if (Math.abs(today - (dayNumber(y, o.m, o.d) + 1)) <= 3) return "shamelnessim"; // Sham El-Nessim, the Monday after Coptic Easter
    if (hijriNear(date, 1, 1, 3)) return "hijri"; // Islamic New Year
    if (hijriNear(date, 3, 12, 3)) return "mawlid"; // the Prophet's birthday (Mawlid)

    const e = easter(y);
    const eDay = dayNumber(y, e.m, e.d);
    if (today >= eDay - 7 && today <= eDay + 1) return "easter";

    if (inRange(12, 1, 12, 26) || inRange(1, 5, 1, 7)) return "christmas"; // 7 January is Christmas Day for Coptic Christians
    if (inRange(12, 27, 12, 31) || inRange(1, 1, 1, 2)) return "newyear";
    if (inRange(10, 20, 10, 31)) return "halloween";

    if (m === 11) {
      const thursday = 1 + ((4 - new Date(y, 10, 1).getDay() + 7) % 7) + 21; // the fourth Thursday
      if (d >= thursday - 10 && d <= thursday + 1) return "thanksgiving";
    }
    if (inRange(7, 1, 7, 4)) return "july4";
    if (inRange(2, 10, 2, 14)) return "valentine";
    if (inRange(3, 14, 3, 17)) return "stpatrick";

    // Mother's Day: the weekend of the second Sunday of May (US), and 21 March (Egypt).
    if (m === 5) {
      const sunday = 1 + ((7 - new Date(y, 4, 1).getDay()) % 7) + 7;
      if (d >= sunday - 2 && d <= sunday) return "mothers";
    }
    if (inRange(3, 19, 3, 21)) return "mothers";
    return "";
  }

  const api = { holidayFor, easter, orthodoxEaster, KEYS };
  if (typeof module === "object" && module.exports) { module.exports = api; return; }
  root.dmeHolidays = api;

  /* ---------- drawing (browser only) ---------- */

  // Each glyph is a tiny 24 x 24 drawing; "fill" shapes take the colour as a fill, "line" shapes as a stroke.
  const G = {
    heart: ["fill", '<path d="M12 21s-7.500-4.600-9.200-9.400C1.700 8.200 3.600 5 6.800 5c1.900 0 3.500 1 5.200 3 1.700-2 3.300-3 5.200-3 3.200 0 5.100 3.200 4 6.600C19.500 16.400 12 21 12 21z"/>'],
    star: ["fill", '<path d="M12 2l2.900 6.200 6.800.8-5 4.700 1.300 6.700L12 17l-6 3.400 1.300-6.700-5-4.700 6.800-.8z"/>'],
    sparkle: ["fill", '<path d="M12 2l2.200 7.800L22 12l-7.800 2.200L12 22l-2.200-7.800L2 12l7.800-2.200z"/>'],
    snowflake: ["line", '<path d="M12 2v20M3.300 7l17.400 10M3.300 17L20.700 7M9 3.500l3 2.500 3-2.500M9 20.500l3-2.500 3 2.500"/>'],
    tree: ["fill", '<path d="M12 2l5 6h-3l4 5h-4l5 6H5l5-6H6l4-5H7z"/><path d="M11 19h2v3h-2z" fill="#8a5a2b"/>'],
    pumpkin: ["fill", '<ellipse cx="12" cy="14" rx="9" ry="7.500"/><path d="M12 7c0-2 1-3.500 3-4" fill="none" stroke="#3f8f4a" stroke-width="2" stroke-linecap="round"/><path d="M8 13l2 2 2-2 2 2 2-2" fill="none" stroke="#5a2d0c" stroke-width="1.400" stroke-linecap="round" stroke-linejoin="round"/>'],
    bat: ["fill", '<path d="M12 8c-1-2-3-3-6-3 1 2 1 4 0 6 2-1 3 0 4 2 .5-1 1.200-1.500 2-1.500s1.500.5 2 1.500c1-2 2-3 4-2-1-2-1-4 0-6-3 0-5 1-6 3z"/>'],
    ghost: ["fill", '<path d="M12 2a7 7 0 0 0-7 7v12l2.500-2 2.300 2 2.200-2 2.200 2 2.300-2 2.500 2V9a7 7 0 0 0-7-7z"/><circle cx="9.500" cy="10" r="1.200" fill="#3a2a5c"/><circle cx="14.500" cy="10" r="1.200" fill="#3a2a5c"/>'],
    leaf: ["fill", '<path d="M4 20C4 10 10 4 20 4c0 10-6 16-16 16z"/><path d="M4 20L14 10" fill="none" stroke="#6b3410" stroke-width="1.200" stroke-linecap="round"/>'],
    acorn: ["fill", '<path d="M6 11h12c0 6-3 10-6 10s-6-4-6-10z"/><path d="M5 11a7 5 0 0 1 14 0z" fill="#8a5a2b"/><path d="M12 6V3" fill="none" stroke="#8a5a2b" stroke-width="1.600" stroke-linecap="round"/>'],
    egg: ["fill", '<ellipse cx="12" cy="13" rx="6.500" ry="8.500"/><path d="M6 13l2.500-2 3 2 3-2 2.500 2" fill="none" stroke="#ffffff" stroke-width="1.600" stroke-linecap="round" stroke-linejoin="round"/>'],
    shamrock: ["fill", '<circle cx="9" cy="9" r="4"/><circle cx="15" cy="9" r="4"/><circle cx="12" cy="14" r="4"/><path d="M12 14v8" fill="none" stroke="#2f7a4a" stroke-width="2" stroke-linecap="round"/>'],
    crescent: ["fill", '<path d="M16 3a9 9 0 1 0 5 15A7.500 7.500 0 0 1 16 3z"/>'],
    lantern: ["fill", '<path d="M10 3h4v2h-4zM8 6h8l1.500 4-1.500 8H8L6.500 10z"/><path d="M10 18h4v3h-4z" fill="#8a6a1f"/><path d="M12 6v12M9.200 10h5.600" fill="none" stroke="#6b4e10" stroke-width="1"/>'],
    firework: ["line", '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M5.600 5.600l3.500 3.500M14.900 14.900l3.500 3.500M18.400 5.600l-3.500 3.500M9.100 14.900l-3.500 3.500"/>'],
    flower: ["fill", '<circle cx="12" cy="6" r="3.500"/><circle cx="18" cy="11" r="3.500"/><circle cx="16" cy="18" r="3.500"/><circle cx="8" cy="18" r="3.500"/><circle cx="6" cy="11" r="3.500"/><circle cx="12" cy="12" r="3" fill="#f7d86b"/>'],
    flag: ["fill", '<path d="M3 3v19" fill="none" stroke="#8a6a3a" stroke-width="1.600" stroke-linecap="round"/><rect x="3.800" y="4" width="17" height="4.300" fill="#ce1126"/><rect x="3.800" y="8.300" width="17" height="4.300" fill="#ffffff"/><rect x="3.800" y="12.600" width="17" height="4.300" fill="#1a1a1a"/><circle cx="12.300" cy="10.450" r="1.500" fill="#c8a43a"/>'],
    pyramid: ["fill", '<path d="M12 3l10 17H2z"/><path d="M12 3v17" fill="none" stroke="#8a6a3a" stroke-width="1.200"/>'],
    sun: ["fill", '<circle cx="12" cy="12" r="4.500"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'],
    gift: ["fill", '<rect x="4" y="10" width="16" height="11" rx="1.500"/><rect x="3" y="7" width="18" height="4" rx="1.500"/><path d="M12 7v14" fill="none" stroke="#ffffff" stroke-width="2"/><path d="M12 7c-3-4-6-2-4 0M12 7c3-4 6-2 4 0" fill="none" stroke="#ffffff" stroke-width="1.500" stroke-linecap="round"/>'],
  };

  // Which little drawings, in which colours, for each holiday.
  const SETS = {
    halloween: [["pumpkin", "#f08a24"], ["bat", "#6c4bb8"], ["ghost", "#f2efff"], ["star", "#f6b73c"], ["pumpkin", "#f08a24"], ["bat", "#6c4bb8"], ["ghost", "#f2efff"]],
    thanksgiving: [["leaf", "#d9822b"], ["acorn", "#c9a14a"], ["leaf", "#b5452a"], ["leaf", "#e0a82e"], ["acorn", "#c9a14a"], ["leaf", "#d9822b"], ["leaf", "#b5452a"]],
    christmas: [["snowflake", "#9fd0ff"], ["tree", "#2f9e63"], ["star", "#f6c945"], ["gift", "#d64545"], ["snowflake", "#9fd0ff"], ["tree", "#2f9e63"], ["star", "#f6c945"]],
    newyear: [["sparkle", "#f6c945"], ["firework", "#9fd0ff"], ["star", "#f6c945"], ["sparkle", "#c9d4e6"], ["firework", "#f08ab4"], ["star", "#f6c945"], ["sparkle", "#9fd0ff"]],
    valentine: [["heart", "#e75a8f"], ["heart", "#d64545"], ["heart", "#f08ab4"], ["heart", "#e75a8f"], ["heart", "#d64545"], ["heart", "#f08ab4"], ["heart", "#e75a8f"]],
    stpatrick: [["shamrock", "#3aa862"], ["star", "#f6c945"], ["shamrock", "#2f9e63"], ["shamrock", "#3aa862"], ["star", "#f6c945"], ["shamrock", "#2f9e63"], ["shamrock", "#3aa862"]],
    easter: [["egg", "#f4a6c8"], ["egg", "#b99be8"], ["flower", "#f08ab4"], ["egg", "#8fd8c0"], ["egg", "#f7d86b"], ["flower", "#b99be8"], ["egg", "#f4a6c8"]],
    ramadan: [["crescent", "#e0b84a"], ["lantern", "#e0b84a"], ["star", "#2aa7b0"], ["lantern", "#d9a21b"], ["crescent", "#e0b84a"], ["star", "#2aa7b0"], ["lantern", "#e0b84a"]],
    eid: [["crescent", "#e0b84a"], ["gift", "#2f9e63"], ["star", "#f6c945"], ["lantern", "#e0b84a"], ["gift", "#2aa7b0"], ["crescent", "#e0b84a"], ["star", "#f6c945"]],
    july4: [["star", "#d64545"], ["firework", "#4f8ff7"], ["star", "#e9eef8"], ["star", "#4f8ff7"], ["firework", "#d64545"], ["star", "#e9eef8"], ["star", "#d64545"]],
    armedforces: [["flag", "#ce1126"], ["star", "#c8a43a"], ["firework", "#ce1126"], ["flag", "#ce1126"], ["star", "#c8a43a"], ["firework", "#e9eef8"], ["flag", "#ce1126"]],
    jan25: [["flag", "#ce1126"], ["star", "#c8a43a"], ["sparkle", "#e9eef8"], ["flag", "#ce1126"], ["star", "#c8a43a"], ["sparkle", "#ce1126"], ["flag", "#ce1126"]],
    sinai: [["sun", "#f0b429"], ["pyramid", "#d9b36c"], ["flag", "#ce1126"], ["star", "#2aa7b0"], ["pyramid", "#d9b36c"], ["sun", "#f0b429"], ["flag", "#ce1126"]],
    june30: [["flag", "#ce1126"], ["firework", "#c8a43a"], ["star", "#e9eef8"], ["flag", "#ce1126"], ["firework", "#ce1126"], ["star", "#c8a43a"], ["flag", "#ce1126"]],
    july23: [["flag", "#ce1126"], ["star", "#c8a43a"], ["firework", "#e9eef8"], ["flag", "#ce1126"], ["star", "#c8a43a"], ["firework", "#ce1126"], ["flag", "#ce1126"]],
    labour: [["flag", "#ce1126"], ["star", "#c8a43a"], ["sparkle", "#2aa7b0"], ["flag", "#ce1126"], ["star", "#c8a43a"], ["sparkle", "#e9eef8"], ["flag", "#ce1126"]],
    shamelnessim: [["egg", "#f4a6c8"], ["flower", "#f7d86b"], ["egg", "#8fd8c0"], ["leaf", "#4caf6a"], ["egg", "#b99be8"], ["flower", "#f4a6c8"], ["egg", "#f7d86b"]],
    hijri: [["crescent", "#e0b84a"], ["star", "#2aa7b0"], ["lantern", "#e0b84a"], ["crescent", "#e0b84a"], ["star", "#2aa7b0"], ["lantern", "#d9a21b"], ["crescent", "#e0b84a"]],
    mawlid: [["lantern", "#e0b84a"], ["star", "#e75a8f"], ["crescent", "#2aa7b0"], ["lantern", "#2f9e63"], ["sparkle", "#f6c945"], ["star", "#4f8ff7"], ["lantern", "#d64545"]],
    mothers: [["flower", "#f08ab4"], ["heart", "#e75a8f"], ["flower", "#f4a6c8"], ["flower", "#ff9a8b"], ["heart", "#e75a8f"], ["flower", "#f08ab4"], ["flower", "#f4a6c8"]],
  };

  const OFF_KEY = "dmeHolidayDecor"; // "off" when switched off
  let strip = null;
  let shownKey = "";

  const switchedOff = () => { try { return localStorage.getItem(OFF_KEY) === "off"; } catch { return false; } };

  // The holiday to draw now: a ?holiday= preview wins, then today's date.
  function current(now = new Date()) {
    try {
      const preview = new URLSearchParams(location.search).get("holiday");
      if (preview && SETS[preview]) return preview;
    } catch { /* no address to read */ }
    return holidayFor(now);
  }

  function glyphSvg([name, colour], i) {
    const [kind, shapes] = G[name];
    const paint = kind === "fill" ? `fill="${colour}"` : `fill="none" stroke="${colour}" stroke-width="2" stroke-linecap="round"`;
    return `<svg class="hd-glyph" style="--i:${i};color:${colour}" viewBox="0 0 24 24" ${paint} aria-hidden="true">${shapes}</svg>`;
  }

  function unmount() {
    if (strip) { strip.remove(); strip = null; }
    shownKey = "";
  }

  function mount() {
    const key = switchedOff() ? "" : current();
    if (key === shownKey && (strip ? strip.isConnected : !key)) return;
    unmount();
    const header = document.querySelector(".app-header");
    const right = header && header.querySelector(".header-right");
    if (!key || !header || !right) return;
    strip = document.createElement("div");
    strip.className = `holiday-strip hd-${key}`;
    strip.setAttribute("aria-hidden", "true");
    strip.innerHTML = SETS[key].map(glyphSvg).join("");
    header.insertBefore(strip, right);
    shownKey = key;
  }

  document.addEventListener("change", (e) => {
    if (!e.target.matches || !e.target.matches("[data-holiday-toggle]")) return;
    try { if (e.target.checked) localStorage.removeItem(OFF_KEY); else localStorage.setItem(OFF_KEY, "off"); } catch { /* not remembered */ }
    mount();
  });

  // The date can roll over while the app stays open.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) mount(); });
  setInterval(mount, 60 * 60 * 1000);

  root.dmeHolidays = Object.assign(api, {
    active: () => current(),
    enabled: () => !switchedOff(),
    mount,
    unmount,
  });
  mount();
})(typeof window !== "undefined" ? window : globalThis);
