/* Small holiday decorations, and the dates Caro dresses up for: only the holidays that have a picture of her. Around each holiday a short string of little ornaments hangs in the empty middle of the
   header, between the logo and your name, and a second set drifts down the empty part of the sidebar (a zigzag when it is
   expanded, one column when it is collapsed). It can't cover anything: it only uses space that is otherwise empty, never
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

  // Day of the Islamic (Umm al-Qura) calendar for a local date, or null where the browser has no such calendar.
  function hijri(date) {
    try {
      const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { month: "numeric", day: "numeric" }).formatToParts(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12));
      const month = Number((parts.find((p) => p.type === "month") || {}).value);
      const day = Number((parts.find((p) => p.type === "day") || {}).value);
      return Number.isFinite(month) && Number.isFinite(day) ? { month, day } : null;
    } catch { return null; }
  }

  const KEYS = ["eid", "ramadan", "armedforces", "easter", "christmas", "newyear", "halloween", "thanksgiving", "july4", "valentine", "stpatrick"];

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

    // 6th of October (Armed Forces Day): the whole week around it, three days either side.
    if (Math.abs(today - dayNumber(y, 10, 6)) <= 3) return "armedforces";

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

    return "";
  }

  const api = { holidayFor, easter, KEYS };
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
    turkey: ["fill", '<ellipse cx="12" cy="7.500" rx="2.300" ry="6" transform="rotate(-62 12 14.500)" fill="#c0392b"/><ellipse cx="12" cy="7.500" rx="2.300" ry="6" transform="rotate(-31 12 14.500)" fill="#e0832a"/><ellipse cx="12" cy="7.500" rx="2.300" ry="6" fill="#e8b73a"/><ellipse cx="12" cy="7.500" rx="2.300" ry="6" transform="rotate(31 12 14.500)" fill="#e0832a"/><ellipse cx="12" cy="7.500" rx="2.300" ry="6" transform="rotate(62 12 14.500)" fill="#c0392b"/><ellipse cx="12" cy="15.500" rx="6" ry="6" /><path d="M7.600 15.500c.4 2.800 2.200 4.500 4.400 4.700M16.400 15.500c-.4 2.800-2.200 4.500-4.400 4.700" fill="none" stroke="#5a3a1a" stroke-width="1" stroke-linecap="round"/><circle cx="12" cy="11" r="2.700" fill="#a8703a"/><circle cx="11" cy="10.300" r=".8" fill="#ffffff"/><circle cx="13" cy="10.300" r=".8" fill="#ffffff"/><circle cx="11.100" cy="10.300" r=".4" fill="#2a1a0a"/><circle cx="12.900" cy="10.300" r=".4" fill="#2a1a0a"/><path d="M11.200 11.600h1.600L12 13z" fill="#f0b02a"/><ellipse cx="12" cy="13.700" rx=".8" ry="1.200" fill="#d64545"/><path d="M10.500 21.500v1.500M13.500 21.500v1.500M9.600 23h1.800M12.600 23h1.800" fill="none" stroke="#e0832a" stroke-width="1" stroke-linecap="round"/>'],
    mapleleaf: ["fill", '<path d="M12 2.500l1.900 3.700 2.600-1.200-.7 4.300 3.500-2-.9 3.500 2.600.9-4.700 3.800.5 1.800-4.600-.7V21.500h-1.400v-3.700l-4.600.7.500-1.800-4.700-3.800 2.600-.9-.9-3.500 3.500 2-.7-4.300 2.600 1.200z"/><path d="M12 21.500V12M12 12l-3-3M12 12l3-3" fill="none" stroke="#6b3410" stroke-width="1" stroke-linecap="round"/>'],
    harvestpumpkin: ["fill", '<ellipse cx="12" cy="14.500" rx="9.500" ry="7.500"/><path d="M12 7.200c-3.200 1.800-4.600 4.600-4.600 7.300s1.400 5.500 4.600 7.300M12 7.200c3.200 1.800 4.600 4.600 4.600 7.300s-1.400 5.500-4.600 7.300M12 7.200c-1 2-1.300 4.700-1.300 7.300s.3 5.300 1.300 7.300M12 7.200c1 2 1.300 4.700 1.300 7.300s-.3 5.300-1.300 7.300" fill="none" stroke="#9a4d0e" stroke-width="1" stroke-linecap="round"/><path d="M12 7.200c0-2 .8-3.400 2.400-4.200" fill="none" stroke="#5a7a2a" stroke-width="2" stroke-linecap="round"/><path d="M14.400 5.500c2.200-1.500 4-.9 4.800.6-1.600 1.200-3.400 1-4.800-.6z" fill="#4caf50"/>'],
    corn: ["fill", '<ellipse cx="12" cy="11" rx="4.200" ry="8.200" transform="rotate(18 12 11)"/><path d="M9.700 6.500l4.200 1.800M8.700 9.500l5.200 2.200M8.700 12.500l5.200 2.200M9.500 15.500l4.100 1.800M11.700 4.200l2 1" fill="none" stroke="#c98e12" stroke-width=".9" stroke-linecap="round"/><path d="M12.300 4.500l3.400 5.800M10.800 4.800l2.600 7M9.800 6.600l1.800 6.500M14.300 6.200l1.500 6.400" fill="none" stroke="#c98e12" stroke-width=".9" stroke-linecap="round"/><path d="M12 22c-5.500 0-8-4.500-8-9.500 3 1.500 5 3.500 6.200 6.200C10.700 20 11.300 21 12 22z" fill="#5fa84a"/><path d="M12 22c5.500 0 8-4.500 8-9.500-3 1.500-5 3.500-6.200 6.200-.5 1.300-1.100 2.300-1.800 3.300z" fill="#4a9238"/>'],
    leaf: ["fill", '<path d="M4 20C4 10 10 4 20 4c0 10-6 16-16 16z"/><path d="M4 20L14 10" fill="none" stroke="#6b3410" stroke-width="1.200" stroke-linecap="round"/>'],
    acorn: ["fill", '<path d="M6 11h12c0 6-3 10-6 10s-6-4-6-10z"/><path d="M5 11a7 5 0 0 1 14 0z" fill="#8a5a2b"/><path d="M12 6V3" fill="none" stroke="#8a5a2b" stroke-width="1.600" stroke-linecap="round"/>'],
    egg: ["fill", '<ellipse cx="12" cy="13" rx="6.500" ry="8.500"/><path d="M6 13l2.500-2 3 2 3-2 2.500 2" fill="none" stroke="#ffffff" stroke-width="1.600" stroke-linecap="round" stroke-linejoin="round"/>'],
    shamrock: ["fill", '<circle cx="9" cy="9" r="4"/><circle cx="15" cy="9" r="4"/><circle cx="12" cy="14" r="4"/><path d="M12 14v8" fill="none" stroke="#2f7a4a" stroke-width="2" stroke-linecap="round"/>'],
    crescent: ["fill", '<path d="M16 3a9 9 0 1 0 5 15A7.500 7.500 0 0 1 16 3z"/>'],
    lantern: ["fill", '<path d="M10 3h4v2h-4zM8 6h8l1.500 4-1.500 8H8L6.500 10z"/><path d="M10 18h4v3h-4z" fill="#8a6a1f"/><path d="M12 6v12M9.200 10h5.600" fill="none" stroke="#6b4e10" stroke-width="1"/>'],
    firework: ["line", '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M5.600 5.600l3.500 3.500M14.900 14.900l3.500 3.500M18.400 5.600l-3.500 3.500M9.100 14.900l-3.500 3.500"/>'],
    flower: ["fill", '<circle cx="12" cy="6" r="3.500"/><circle cx="18" cy="11" r="3.500"/><circle cx="16" cy="18" r="3.500"/><circle cx="8" cy="18" r="3.500"/><circle cx="6" cy="11" r="3.500"/><circle cx="12" cy="12" r="3" fill="#f7d86b"/>'],
    flag: ["fill", '<path d="M3 3v19" fill="none" stroke="#8a6a3a" stroke-width="1.600" stroke-linecap="round"/><rect x="3.800" y="4" width="17" height="4.300" fill="#ce1126"/><rect x="3.800" y="8.300" width="17" height="4.300" fill="#ffffff"/><rect x="3.800" y="12.600" width="17" height="4.300" fill="#1a1a1a"/><circle cx="12.300" cy="10.450" r="1.500" fill="#c8a43a"/>'],
    usflag: ["fill", '<path d="M3 3v19" fill="none" stroke="#8a6a3a" stroke-width="1.600" stroke-linecap="round"/><rect x="3.800" y="4" width="17" height="2.800" fill="#d64545"/><rect x="3.800" y="6.800" width="17" height="2.800" fill="#ffffff"/><rect x="3.800" y="9.600" width="17" height="2.800" fill="#d64545"/><rect x="3.800" y="12.400" width="17" height="2.800" fill="#ffffff"/><rect x="3.800" y="4" width="7.500" height="5.600" fill="#2f4f9e"/><circle cx="6" cy="6" r=".7" fill="#ffffff"/><circle cx="8.500" cy="6" r=".7" fill="#ffffff"/><circle cx="7.200" cy="8" r=".7" fill="#ffffff"/>'],
    jet: ["fill", '<path d="M12 2c1 0 1.500 1 1.500 2.500V10l8 5v2l-8-2v4l2.500 2v1.500L12 21l-4 1.500V21l2.500-2v-4l-8 2v-2l8-5V4.500C10.500 3 11 2 12 2z"/>'],
    shield: ["fill", '<path d="M12 2l8 3v6c0 5-3.500 9-8 11C7.500 20 4 16 4 11V5z"/><path d="M12 7.500l1.300 2.800 3 .4-2.200 2.100.6 3L12 14.300 9.300 15.800l.6-3-2.200-2.100 3-.4z" fill="#ffffff"/>'],
    laurel: ["fill", '<path d="M8.500 21C4 17 3.500 9.500 8 3.500M15.500 21c4.500-4 5-11.500.5-17.500" fill="none" stroke="currentColor" stroke-width="1.600" stroke-linecap="round"/><ellipse cx="6" cy="8" rx="1.600" ry="3" transform="rotate(-25 6 8)"/><ellipse cx="5.500" cy="13" rx="1.600" ry="3" transform="rotate(-10 5.500 13)"/><ellipse cx="7.500" cy="17.500" rx="1.600" ry="3" transform="rotate(10 7.500 17.500)"/><ellipse cx="18" cy="8" rx="1.600" ry="3" transform="rotate(25 18 8)"/><ellipse cx="18.500" cy="13" rx="1.600" ry="3" transform="rotate(10 18.500 13)"/><ellipse cx="16.500" cy="17.500" rx="1.600" ry="3" transform="rotate(-10 16.500 17.500)"/>'],
    wheat: ["fill", '<path d="M12 22V8" fill="none" stroke="#8a6a1f" stroke-width="1.600" stroke-linecap="round"/><ellipse cx="9.200" cy="9" rx="1.700" ry="3.200" transform="rotate(-28 9.200 9)"/><ellipse cx="14.800" cy="9" rx="1.700" ry="3.200" transform="rotate(28 14.800 9)"/><ellipse cx="9" cy="14" rx="1.700" ry="3.200" transform="rotate(-28 9 14)"/><ellipse cx="15" cy="14" rx="1.700" ry="3.200" transform="rotate(28 15 14)"/><ellipse cx="12" cy="5" rx="1.700" ry="3.200"/>'],
    gift: ["fill", '<rect x="4" y="10" width="16" height="11" rx="1.500"/><rect x="3" y="7" width="18" height="4" rx="1.500"/><path d="M12 7v14" fill="none" stroke="#ffffff" stroke-width="2"/><path d="M12 7c-3-4-6-2-4 0M12 7c3-4 6-2 4 0" fill="none" stroke="#ffffff" stroke-width="1.500" stroke-linecap="round"/>'],
  };

  // Which little drawings, in which colours, for each holiday.
  const SETS = {
    halloween: [["pumpkin", "#f08a24"], ["bat", "#6c4bb8"], ["ghost", "#f2efff"], ["star", "#f6b73c"], ["pumpkin", "#f08a24"], ["bat", "#6c4bb8"], ["ghost", "#f2efff"]],
    thanksgiving: [["mapleleaf", "#d9822b"], ["acorn", "#c9a14a"], ["turkey", "#8a5a2b"], ["harvestpumpkin", "#e0832a"], ["corn", "#f0c24a"], ["mapleleaf", "#b5452a"], ["wheat", "#d9a21b"]],
    christmas: [["snowflake", "#9fd0ff"], ["tree", "#2f9e63"], ["star", "#f6c945"], ["gift", "#d64545"], ["snowflake", "#9fd0ff"], ["tree", "#2f9e63"], ["star", "#f6c945"]],
    newyear: [["sparkle", "#f6c945"], ["firework", "#9fd0ff"], ["star", "#f6c945"], ["sparkle", "#c9d4e6"], ["firework", "#f08ab4"], ["star", "#f6c945"], ["sparkle", "#9fd0ff"]],
    valentine: [["heart", "#e75a8f"], ["gift", "#d64545"], ["heart", "#f08ab4"], ["sparkle", "#f6c945"], ["heart", "#d64545"], ["flower", "#f08ab4"], ["heart", "#e75a8f"]],
    stpatrick: [["shamrock", "#3aa862"], ["star", "#f6c945"], ["shamrock", "#2f9e63"], ["sparkle", "#3aa862"], ["star", "#f6c945"], ["shamrock", "#3aa862"], ["sparkle", "#f6c945"]],
    easter: [["egg", "#f4a6c8"], ["flower", "#b99be8"], ["egg", "#8fd8c0"], ["leaf", "#4caf6a"], ["egg", "#f7d86b"], ["flower", "#f4a6c8"], ["egg", "#b99be8"]],
    ramadan: [["crescent", "#e0b84a"], ["lantern", "#e0b84a"], ["star", "#2aa7b0"], ["lantern", "#d9a21b"], ["crescent", "#e0b84a"], ["star", "#2aa7b0"], ["lantern", "#e0b84a"]],
    eid: [["crescent", "#e0b84a"], ["gift", "#2f9e63"], ["star", "#f6c945"], ["lantern", "#e0b84a"], ["gift", "#2aa7b0"], ["crescent", "#e0b84a"], ["star", "#f6c945"]],
    july4: [["usflag", "#d64545"], ["star", "#e9eef8"], ["firework", "#4f8ff7"], ["usflag", "#d64545"], ["star", "#4f8ff7"], ["firework", "#d64545"], ["usflag", "#d64545"]],
    armedforces: [["flag", "#ce1126"], ["jet", "#e9eef8"], ["firework", "#ce1126"], ["shield", "#c8a43a"], ["laurel", "#c8a43a"], ["jet", "#e9eef8"], ["flag", "#ce1126"]],
  };

  const OFF_KEY = "dmeHolidayDecor"; // "off" when switched off
  let strip = null;
  let side = null;
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

  // One shared gradient (white shine at the top, a little shadow at the bottom) laid over every filled drawing so it reads as a
  // rounded object instead of a flat shape. It lives in a tiny hidden svg that is added once.
  function ensureShade() {
    if (document.getElementById("hdShadeDefs")) return;
    const holder = document.createElement("div");
    holder.id = "hdShadeDefs";
    holder.setAttribute("aria-hidden", "true");
    holder.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    holder.innerHTML = '<svg width="0" height="0"><defs><linearGradient id="hdShade" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.6"/><stop offset="0.45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.3"/></linearGradient></defs></svg>';
    document.body.appendChild(holder);
  }


  // A cooked turkey on a platter for the greeting cards (Today and the super admin Home) while it is Thanksgiving. Drawn once here,
  // with its own gradients, so the cards only have to ask for it. "" on any other day, or when decorations are switched off.
  const DISH = `<svg class="holiday-dish-svg" viewBox="0 0 170 116" aria-hidden="true">
    <defs>
      <radialGradient id="hdSkin" cx="40%" cy="28%" r="82%"><stop offset="0" stop-color="#f7c26a"/><stop offset="0.45" stop-color="#d98a30"/><stop offset="0.8" stop-color="#a85a1c"/><stop offset="1" stop-color="#6e3410"/></radialGradient>
      <linearGradient id="hdLeg" x1="0.1" y1="0" x2="0.9" y2="1"><stop offset="0" stop-color="#eba24a"/><stop offset="0.6" stop-color="#bb6a24"/><stop offset="1" stop-color="#7c3c12"/></linearGradient>
      <linearGradient id="hdPlate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfc7b6"/></linearGradient>
      <linearGradient id="hdRim" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#d9b25a"/><stop offset="0.5" stop-color="#f6e0a0"/><stop offset="1" stop-color="#c79a3c"/></linearGradient>
      <filter id="hdSoft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.600"/></filter>
    </defs>
    <ellipse cx="85" cy="108" rx="68" ry="6" fill="rgba(0,0,0,0.3)"/>
    <ellipse cx="85" cy="92" rx="78" ry="19" fill="url(#hdPlate)" stroke="url(#hdRim)" stroke-width="3"/>
    <ellipse cx="85" cy="92" rx="64" ry="13.500" fill="none" stroke="#d6cdb8" stroke-width="1.200"/>
    <ellipse cx="85" cy="91" rx="56" ry="10" fill="rgba(0,0,0,0.1)"/>
    <g class="dish-garnish">
      <g fill="#3a8f40"><ellipse cx="15" cy="84" rx="8" ry="3.800" transform="rotate(-30 15 84)"/><ellipse cx="22" cy="92" rx="7" ry="3.400" transform="rotate(14 22 92)"/><ellipse cx="29" cy="82" rx="6.500" ry="3.200" transform="rotate(-62 29 82)"/><ellipse cx="155" cy="84" rx="8" ry="3.800" transform="rotate(30 155 84)"/><ellipse cx="148" cy="92" rx="7" ry="3.400" transform="rotate(-14 148 92)"/><ellipse cx="141" cy="82" rx="6.500" ry="3.200" transform="rotate(62 141 82)"/></g>
      <g fill="#58b25a"><ellipse cx="19" cy="86" rx="5" ry="2.200" transform="rotate(-20 19 86)"/><ellipse cx="151" cy="86" rx="5" ry="2.200" transform="rotate(20 151 86)"/></g>
      <g><circle cx="38" cy="100" r="7.500" fill="#f09a2a"/><circle cx="38" cy="100" r="5.800" fill="#fbc45a"/><path d="M38 94.200v11.600M32.200 100h11.600M34 96l8 8M42 96l-8 8" stroke="#f09a2a" stroke-width=".9"/>
        <circle cx="132" cy="100" r="7.500" fill="#f09a2a"/><circle cx="132" cy="100" r="5.800" fill="#fbc45a"/><path d="M132 94.200v11.600M126.200 100h11.600M128 96l8 8M136 96l-8 8" stroke="#f09a2a" stroke-width=".9"/></g>
      <g fill="#c4202f"><circle cx="24" cy="98" r="3.600"/><circle cx="30" cy="104" r="3.200"/><circle cx="19" cy="103" r="2.800"/><circle cx="146" cy="98" r="3.600"/><circle cx="140" cy="104" r="3.200"/><circle cx="151" cy="103" r="2.800"/></g>
      <g fill="rgba(255,255,255,0.55)"><circle cx="23" cy="96.800" r="1"/><circle cx="29" cy="102.800" r="1"/><circle cx="145" cy="96.800" r="1"/><circle cx="139" cy="102.800" r="1"/></g>
    </g>
    <ellipse cx="85" cy="86" rx="46" ry="8" fill="rgba(0,0,0,0.28)" filter="url(#hdSoft)"/>
    <path d="M36 70C36 44 58 28 85 28s49 16 49 42c0 14-22 22-49 22S36 84 36 70z" fill="url(#hdSkin)"/>
    <path d="M44 56c6-12 20-20 40-20" fill="none" stroke="#ffe7b0" stroke-width="7" stroke-linecap="round" opacity="0.45" filter="url(#hdSoft)"/>
    <ellipse cx="60" cy="46" rx="14" ry="6" fill="#fff3d0" opacity="0.5" transform="rotate(-18 60 46)"/>
    <path d="M85 32c-2 14-2 34 0 56" fill="none" stroke="#7c3c12" stroke-width="1.400" opacity="0.35"/>
    <g fill="none" stroke="#5e2c0c" stroke-width="1.200" stroke-linecap="round" opacity="0.5"><path d="M50 62c6 5 14 8 23 8M97 70c9 0 17-3 23-8M58 52c5 3 11 5 17 5M96 57c6 0 12-2 17-5M64 78c7 3 14 4 21 4M104 78c-5 2-9 3-13 3"/></g>
    <g class="dish-legs">
      <ellipse cx="47" cy="77" rx="16" ry="10" transform="rotate(-26 47 77)" fill="url(#hdLeg)"/>
      <ellipse cx="43" cy="72.500" rx="9" ry="3" transform="rotate(-26 43 72.500)" fill="#ffe0a0" opacity="0.5"/>
      <path d="M35 83l-9 6" stroke="#f7f1e2" stroke-width="4.600" stroke-linecap="round"/><circle cx="22.500" cy="91" r="3.900" fill="#f7f1e2"/><circle cx="26.500" cy="94" r="3.500" fill="#f7f1e2"/>
      <path d="M31 80.500l5 4.200-2.200 3-5.200-2.600z" fill="#fff" stroke="#d8cfba" stroke-width=".6"/>
      <ellipse cx="123" cy="77" rx="16" ry="10" transform="rotate(26 123 77)" fill="url(#hdLeg)"/>
      <ellipse cx="127" cy="72.500" rx="9" ry="3" transform="rotate(26 127 72.500)" fill="#ffe0a0" opacity="0.5"/>
      <path d="M135 83l9 6" stroke="#f7f1e2" stroke-width="4.600" stroke-linecap="round"/><circle cx="147.500" cy="91" r="3.900" fill="#f7f1e2"/><circle cx="143.500" cy="94" r="3.500" fill="#f7f1e2"/>
      <path d="M139 80.500l-5 4.200 2.200 3 5.200-2.600z" fill="#fff" stroke="#d8cfba" stroke-width=".6"/>
    </g>
    <g fill="#ffe6a0" opacity="0.9"><circle cx="58" cy="44" r="1.500"/><circle cx="72" cy="38" r="1.300"/><circle cx="90" cy="36" r="1.300"/><circle cx="106" cy="42" r="1.500"/><circle cx="118" cy="54" r="1.300"/><circle cx="52" cy="58" r="1.300"/><circle cx="82" cy="50" r="1.200"/><circle cx="100" cy="52" r="1.200"/></g>
    <g fill="#3a8f40"><ellipse cx="86" cy="30" rx="6" ry="2.600" transform="rotate(-20 86 30)"/><ellipse cx="94" cy="32" rx="5" ry="2.300" transform="rotate(25 94 32)"/><ellipse cx="78" cy="32" rx="5" ry="2.300" transform="rotate(-50 78 32)"/></g>
    <circle cx="92" cy="30" r="2.600" fill="#c4202f"/><circle cx="82" cy="31" r="2.200" fill="#c4202f"/>
    <g fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="2.400" stroke-linecap="round"><path class="dish-steam s1" d="M62 22c-4-5 4-8 0-14"/><path class="dish-steam s2" d="M85 18c-4-5 4-8 0-15"/><path class="dish-steam s3" d="M108 22c-4-5 4-8 0-14"/></g>
  </svg>`;
  const dishHtml = () => (!switchedOff() && current() === "thanksgiving" ? `<span class="holiday-dish" aria-hidden="true">${DISH}</span>` : "");

  function glyphSvg([name, colour], i) {
    const [kind, shapes] = G[name];
    const paint = kind === "fill" ? `fill="${colour}"` : `fill="none" stroke="${colour}" stroke-width="2" stroke-linecap="round"`;
    const shade = kind === "fill" ? `<g fill="url(#hdShade)" stroke="none">${shapes}</g>` : "";
    // Each ornament hangs from a little cord (drawn by CSS on .hd-item) and twinkles with a small spark of its own.
    return `<span class="hd-item" style="--i:${i}"><svg class="hd-glyph" style="color:${colour}" viewBox="0 0 24 24" ${paint} stroke-linejoin="round" aria-hidden="true">${shapes}${shade}</svg></span>`;
  }

  function unmount() {
    if (strip) { strip.remove(); strip = null; }
    if (side) { side.remove(); side = null; }
    shownKey = "";
  }

  function mount() {
    const key = switchedOff() ? "" : current();
    if (key === shownKey && (strip ? strip.isConnected && (!side || side.isConnected) : !key)) return;
    unmount();
    const header = document.querySelector(".app-header");
    const right = header && header.querySelector(".header-right");
    if (!key || !header || !right) return;
    ensureShade();
    strip = document.createElement("div");
    strip.className = `holiday-strip hd-${key}`;
    strip.setAttribute("aria-hidden", "true");
    strip.innerHTML = SETS[key].map(glyphSvg).join("");
    header.insertBefore(strip, right);
    // The sidebar gets its own take: the same ornaments in the opposite order, zigzagging down the empty space above Quick
    // actions (or in a single column when the sidebar is collapsed to its icon rail).
    const nav = document.querySelector(".view-tabs");
    const action = nav && nav.querySelector(".nav-action");
    if (nav && action) {
      side = document.createElement("div");
      side.className = `holiday-side hd-${key}`;
      side.setAttribute("aria-hidden", "true");
      side.innerHTML = SETS[key].slice().reverse().map((g, i) => glyphSvg(g, i)).join("");
      nav.insertBefore(side, action);
    }
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
    dishHtml,
    mount,
    unmount,
  });
  mount();
})(typeof window !== "undefined" ? window : globalThis);
