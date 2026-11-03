/* The prize wheel: what is on it, how a spin is decided, and what a prize gives (a "perk" that lasts a day or a few).
   Pure, so it is tested without a browser (worker/test/wheel.test.js). perks.js applies the perks to the page and
   buddy-fun.js draws the wheel. Perks are cosmetic or small conveniences for the person who won them, kept on this device. */
(function (root) {
  "use strict";

  const DAY = 86400000;

  const FRAMES = ["gold", "silver", "aurora"];
  const TITLES = ["Closer", "Dial Machine", "Smooth Talker", "Gatekeeper Whisperer", "Pickup Pro", "Callback Champ"];
  const LOOKS = ["party", "thumbs", "wink", "phone", "thinking", "encourage"];
  const DECOS = ["sparkles", "confetti", "glow"];
  const ACCENTS = ["violet", "rose", "amber", "green"];

  const NAMES = {
    gold: "Gold", silver: "Silver", aurora: "Aurora", sparkles: "Sparkles", confetti: "Confetti", glow: "Glow",
    violet: "Violet", rose: "Rose", amber: "Amber", green: "Green",
    party: "party", thumbs: "thumbs-up", wink: "wink", phone: "on-the-phone", thinking: "thinking", encourage: "encouraging",
  };

  // Eight equal slices on the wheel; "weight" is how likely each one is to come up (the rarer ones are meant to feel special).
  const PRIZES = [
    { id: "frame", kind: "frame", short: "Frame", label: "Profile frame", weight: 18, days: 1, options: FRAMES },
    { id: "title", kind: "title", short: "Title", label: "Title by your name", weight: 18, days: 1, options: TITLES },
    { id: "look", kind: "look", short: "Look", label: "Caro look", weight: 16, days: 1, options: LOOKS },
    { id: "deco", kind: "deco", short: "Sparkle", label: "Header sparkle", weight: 14, days: 1, options: DECOS },
    { id: "accent", kind: "accent", short: "Colour", label: "App colour", weight: 10, days: 3, options: ACCENTS },
    { id: "pick", kind: "pick", short: "Pick", label: "Caro's lead pick", weight: 12, days: 1, options: ["on"] },
    { id: "snooze", kind: "snooze", short: "Snooze", label: "Extra snooze", weight: 8, days: 7, options: [1] },
    { id: "golden", kind: "golden", short: "Kudos", label: "Golden kudos", weight: 4, days: 7, options: [1] },
  ];

  const total = PRIZES.reduce((t, p) => t + p.weight, 0);

  function weightedIndex(rng = Math.random) {
    let roll = rng() * total;
    for (let i = 0; i < PRIZES.length; i += 1) {
      roll -= PRIZES[i].weight;
      if (roll < 0) return i;
    }
    return PRIZES.length - 1;
  }

  // Which frame, title, look... this win gives.
  const resolve = (index, rng = Math.random) => {
    const options = PRIZES[index].options;
    return options[Math.min(options.length - 1, Math.floor(rng() * options.length))];
  };

  // The last moment of the day the prize is won, plus any further days it lasts.
  function untilFor(index, now = Date.now()) {
    const d = new Date(now);
    d.setHours(23, 59, 59, 999);
    return d.getTime() + (PRIZES[index].days - 1) * DAY;
  }

  const grant = (perks, index, value, now = Date.now()) => ({ ...perks, [PRIZES[index].kind]: { value, until: untilFor(index, now) } });
  const activeValue = (perks, kind, now = Date.now()) => {
    const p = perks && perks[kind];
    return p && p.until > now ? p.value : null;
  };
  // The same perks without the ones that have run out (keeps bookkeeping entries such as lookRestore).
  function prune(perks, now = Date.now()) {
    const out = {};
    for (const [kind, p] of Object.entries(perks || {})) if (!p || typeof p.until !== "number" || p.until > now) out[kind] = p;
    return out;
  }
  const consume = (perks, kind) => { const out = { ...perks }; delete out[kind]; return out; };

  // How far to turn the disc (clockwise, in degrees) so the middle of slice `index` ends up under the pointer at the top.
  function spinAngle(index, turns = 5, rng = Math.random) {
    const seg = 360 / PRIZES.length;
    const jitter = (rng() - 0.5) * seg * 0.6; // lands somewhere inside the slice, not always dead centre
    return turns * 360 - (index + 0.5) * seg + jitter;
  }

  const name = (v) => NAMES[v] || String(v);
  function describe(index, value) {
    switch (PRIZES[index].kind) {
      case "frame": return `A ${name(value).toLowerCase()} frame around your picture until tomorrow.`;
      case "title": return `You are "${value}" until tomorrow, shown next to your name.`;
      case "look": return `Caro wears her ${name(value)} look until tomorrow.`;
      case "deco": return `${name(value)} around your name until tomorrow.`;
      case "accent": return `${name(value)} as the app's colour for 3 days.`;
      case "pick": return "Caro picks the best lead to call on Today, until tomorrow.";
      case "snooze": return "One extra snooze: push any reminder back a day, from its Reminder box in Claimed.";
      default: return "A golden kudos to send a teammate. It pops up for them with confetti.";
    }
  }

  const api = { PRIZES, FRAMES, TITLES, LOOKS, DECOS, ACCENTS, weightedIndex, resolve, untilFor, grant, activeValue, prune, consume, spinAngle, describe };
  if (typeof module === "object" && module.exports) { module.exports = api; return; }
  root.dmeWheel = api;
})(typeof window !== "undefined" ? window : globalThis);
