/* A small set of line icons (inline SVG, drawn in the current text colour) used instead of emoji.
   uiIcon("calendar") returns an <svg> string; an optional second argument adds a CSS class.
   Loaded before app.js so every screen can use it. */
(function () {
  "use strict";

  const PATHS = {
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    bell: '<path d="M6 17v-6a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4"/>',
    flame: '<path d="M12 3c.9 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.200 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>',
    thumb: '<path d="M7 11v9H4v-9z"/><path d="M7 11l4-8c2 0 3 1 2.500 3L13 9h5.500a2 2 0 0 1 2 2.400l-1.200 6A2 2 0 0 1 17.300 19H7"/>',
    heart: '<path d="M12 20s-7-4.500-7-10a4 4 0 0 1 7-2.500A4 4 0 0 1 19 10c0 5.500-7 10-7 10z"/>',
    party: '<path d="M4 20l4-12 8 8z"/><path d="M14 4v2M19 9h2M17 5l1.500-1.500M11 3.500l.5 1.500"/>',
    sunrise: '<path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 5v3M5 10l2 2M19 10l-2 2"/>',
    rocket: '<path d="M12 3c3 2 4.500 5 4.500 8l-2 3h-5l-2-3C7.500 8 9 5 12 3z"/><circle cx="12" cy="9.500" r="1.500"/><path d="M9.500 17l-1 4 3.500-2 3.500 2-1-4"/>',
    bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8M10 17h4"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.8" fill="currentColor"/>',
    puzzle: '<path d="M5 8h4V6a2 2 0 1 1 4 0v2h4v4h-2a2 2 0 1 0 0 4h2v4H5z"/>',
    megaphone: '<path d="M4 10v4l12 5V5z"/><path d="M16 9a3 3 0 0 1 0 6M7 14l1 5h3l-1-4"/>',
    wheel: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16M6.300 6.300l11.400 11.400M17.700 6.300 6.300 17.700"/>',
    phone: '<path d="M6 3h4l2 5-2.500 1.500a11 11 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
    cake: '<path d="M4 20h16v-6H4z"/><path d="M4 14c2-2 3 1 4 0s2-2 4 0 3-2 4 0 2 2 4 0M12 6v4M12 3v1"/>',
    sparkle: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
    snowflake: '<path d="M12 3v18M4 7.500l16 9M4 16.500l16-9"/>',
    pumpkin: '<ellipse cx="12" cy="14" rx="8" ry="6"/><path d="M12 8c0-2 1-3 2-3M9 9c-1 3-1 6 0 10M15 9c1 3 1 6 0 10"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.600 5.600 7 7M17 17l1.400 1.400M5.600 18.400 7 17M17 7l1.400-1.400"/>',
    check: '<path d="M5 12.500l4.500 4.500L19 7.500"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8.500 14.500a4.500 4.500 0 0 0 7 0"/><circle cx="9" cy="10" r="0.8" fill="currentColor"/><circle cx="15" cy="10" r="0.8" fill="currentColor"/>',
    meh: '<circle cx="12" cy="12" r="9"/><path d="M9 15h6"/><circle cx="9" cy="10" r="0.8" fill="currentColor"/><circle cx="15" cy="10" r="0.8" fill="currentColor"/>',
    frown: '<circle cx="12" cy="12" r="9"/><path d="M8.500 16.500a4.500 4.500 0 0 1 7 0"/><circle cx="9" cy="10" r="0.8" fill="currentColor"/><circle cx="15" cy="10" r="0.8" fill="currentColor"/>',
  };

  window.uiIcon = function uiIcon(name, extraClass) {
    return `<svg class="ui-icon${extraClass ? ` ${extraClass}` : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ""}</svg>`;
  };
})();
