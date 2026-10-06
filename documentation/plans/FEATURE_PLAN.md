# Prospector — Confirmed Feature Plan

**Last updated:** 2026-10-06
**Stack:** `docs/` (GitHub Pages) · `worker/` (Cloudflare, Hono) · Supabase

> Features listed here have been reviewed and approved for implementation.
> See `UNCONFIRMED_SUGGESTIONS.md` (same folder) for ideas not yet approved.

---

## Feature 1 — Unified call mode: prospect mode gets the same disposition panel

**Priority:** P1
**Source:** DME Dialer §1.4 + user review 2026-10-06

### What

Currently, **prospect mode** in `callmode.js` shows only a short hint and a "Claim & next" button. **Claimed mode** shows a full panel: status chips (How did it go?), a note textarea, and a callback picker.

The change: make prospect mode show the **same status-chip panel** as claimed mode. Clicking a chip immediately **claims the lead and advances** — no separate button press needed.

### New flow (prospect mode)

1. Rep opens call mode from Prospect results.
2. Drawer shows: company info → phone buttons → **status chips** (VM / GK / NA / NI / Disconnected) → optional note textarea.
3. Rep clicks a chip (e.g. **VM**) → `claimProspect()` is called immediately with that status embedded in the note → lead claimed → drawer advances to the next lead automatically.
4. If rep wants to add a note first, they type in the textarea, then click a chip to claim+advance.
5. "Claim & next" button is removed — the chip click is the action.
6. "Skip" still skips without claiming (unchanged).

### Implementation notes

**`docs/callmode.js` — render()**

Replace the current prospect-mode `work` block:
```js
// OLD (prospect mode work block)
work = '<div class="cm-hint">Claiming puts this lead under your name…</div>';
```
With the same chip panel as claimed mode:
```js
// NEW
const PROSPECT_STATUSES = ["VM", "GK", "NA", "NI", "Disconnected"];
work = `
  <div class="cm-label">How did it go?</div>
  <div class="cm-chips">${chipsHtml(PROSPECT_STATUSES, "cm-status", run.status)}</div>
  <textarea class="cm-note" rows="3" maxlength="500" placeholder="Add a note (optional)">${escapeHtml(run.note)}</textarea>`;
```

No callback picker in prospect mode — claim-only, no reminder scheduling until the lead is in Claimed.

**`docs/callmode.js` — onClick()**

After setting `run.status` on a `cm-status` chip click, if in prospect mode and a status was just set (not toggled off), immediately call `primary()`:
```js
if (isStatus) {
  run.status = value;
  if (run.mode === "prospect" && value) primary(); // claim on chip tap
}
```

**`docs/callmode.js` — claimProspect()**

After the claim succeeds, if `run.status` or `run.note` is set, post a follow-up note using the same `leads/notes` endpoint that `saveClaimed` uses:
```js
if (claimed && (run.status || run.note.trim())) {
  const note = [run.status, run.note.trim()].filter(Boolean).join(" — ");
  await apiPost("leads/notes", { npi: String(company.npi), note });
}
```

**`docs/callmode.js` — footer**

Remove `primaryLabel = "Claim & next"` for prospect mode. The footer for prospect mode becomes: `Back | Skip` only.

### Affected files

| File | Change |
|---|---|
| `docs/callmode.js` | Prospect `work` block, `onClick` chip handler, `claimProspect()` note pass-through, footer label removal |

---

## Feature 2 — Lead local time in call drawer

**Priority:** P2
**Source:** DME Dialer §1.2 — Lead local time

### What

Show the lead's current local time (and short timezone label) inline next to their state in the call mode drawer metadata bar. Prevents reps from dialing at 7am or 9pm the lead's time.

Example: `FL · 11:42 AM ET`

### Implementation

**Add `STATE_TO_TZ` map** in `docs/usLocations.js` (shared with Feature 5):

```js
const STATE_TO_TZ = {
  CT:"America/New_York", ME:"America/New_York", MA:"America/New_York",
  NH:"America/New_York", NJ:"America/New_York", NY:"America/New_York",
  PA:"America/New_York", RI:"America/New_York", VT:"America/New_York",
  DE:"America/New_York", DC:"America/New_York", FL:"America/New_York",
  GA:"America/New_York", IN:"America/New_York", MD:"America/New_York",
  MI:"America/New_York", NC:"America/New_York", OH:"America/New_York",
  SC:"America/New_York", VA:"America/New_York", WV:"America/New_York",
  AL:"America/Chicago",  AR:"America/Chicago",  IL:"America/Chicago",
  IA:"America/Chicago",  KS:"America/Chicago",  KY:"America/Chicago",
  LA:"America/Chicago",  MN:"America/Chicago",  MS:"America/Chicago",
  MO:"America/Chicago",  NE:"America/Chicago",  ND:"America/Chicago",
  OK:"America/Chicago",  SD:"America/Chicago",  TN:"America/Chicago",
  TX:"America/Chicago",  WI:"America/Chicago",
  AZ:"America/Phoenix",  CO:"America/Denver",   ID:"America/Denver",
  MT:"America/Denver",   NM:"America/Denver",   UT:"America/Denver",
  WY:"America/Denver",
  CA:"America/Los_Angeles", NV:"America/Los_Angeles", OR:"America/Los_Angeles",
  WA:"America/Los_Angeles", AK:"America/Anchorage",   HI:"Pacific/Honolulu",
};
```

**Add helper in `docs/callmode.js`:**
```js
function leadLocalTime(state) {
  if (!window.STATE_TO_TZ) return "";
  const tz = window.STATE_TO_TZ[state];
  if (!tz) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit", timeZoneName: "short"
  }).format(new Date());
}
```

**Render:** In `render()`, extract state from `info.place` (e.g. `"Orlando, FL"` → `"FL"`) and append `leadLocalTime(state)` to the `cm-sub cm-muted` line.

### Affected files

| File | Change |
|---|---|
| `docs/usLocations.js` | Export `STATE_TO_TZ` as `window.STATE_TO_TZ` (shared with Feature 5) |
| `docs/callmode.js` | `leadLocalTime()` helper, call in `render()` |

---

## Feature 3 — Shuffle queue in call mode

**Priority:** P3
**Source:** DME Dialer §1.5 — RANDOM button

### What

Add a **Shuffle** toggle so call mode steps through selected leads in random order rather than the order they appear in the table. Useful for avoiding always hitting the same geographic or alphabetical cluster first.

### Implementation

```js
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
```

Call `shuffleArray(run.queue)` inside `start()` based on a persisted toggle:
```js
const shouldShuffle = localStorage.getItem("dmeProspectorCallShuffle") === "1";
if (shouldShuffle) shuffleArray(run.queue);
```

The toggle lives in the call drawer's start screen (rendered before the first lead). A small checkbox or icon button: "Shuffle order".

### Affected files

| File | Change |
|---|---|
| `docs/callmode.js` | `shuffleArray()`, shuffle preference read in `start()`, toggle in start screen |

---

## Feature 4 — Admin default taxonomy

**Priority:** P2
**Source:** User request 2026-10-06

### What

Allow an admin to designate one taxonomy as the **team default**. When any rep opens the search form, that taxonomy is pre-selected in the multiselect — they can still change it freely, but don't have to pick one every time.

### Data model

```sql
-- sql/028_default_taxonomy.sql
ALTER TABLE taxonomies
  ADD COLUMN IF NOT EXISTS default_for_search boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS taxonomies_one_default
  ON taxonomies (default_for_search)
  WHERE default_for_search = true;
```

### Backend

**`worker/src/repos/taxonomiesRepo.js`:**
- Add `defaultForSearch: row.default_for_search` to `toDTO()`.
- Add `setDefault(supabase, id)`: sets `default_for_search = false` on all rows, then `true` on the target row.

**`worker/src/index.js`:**
- Add `POST /api/admin/taxonomies/:id/set-default` (admin-only gate) calling `taxonomiesRepo.setDefault`.

### Frontend — Controls panel (`docs/controls.js`)

Under Admin → Controls, add a **"Default search taxonomy"** section:
- A `<select>` populated from the enabled taxonomy list.
- Current default is pre-selected.
- On change, calls `POST /api/admin/taxonomies/:id/set-default`.

### Frontend — Search form (`docs/app.js`)

After the enabled taxonomy list loads on init, if any has `defaultForSearch: true`, pre-check that taxonomy's checkbox in `taxonomyMultiselect` — but **only if no saved search is already active** (don't override saved searches or a prior user selection in the same session).

### Affected files

| File | Change |
|---|---|
| `sql/028_default_taxonomy.sql` | New migration (apply manually per project convention) |
| `worker/src/repos/taxonomiesRepo.js` | `toDTO` + `setDefault()` |
| `worker/src/index.js` | New admin route |
| `docs/controls.js` | Default taxonomy picker in Controls panel |
| `docs/app.js` | Pre-select on form init |

---

## Feature 5 — "9am States" calling-window indicator

**Priority:** P3
**Source:** User idea → confirmed 2026-10-06

### What

In the state multiselect on the search form, visually indicate which states are currently in the **9am–5pm calling window** (local time). Passive indicator only — no auto-selection, no overriding saved searches or current selections.

**UX:** State checkboxes currently in-window get a subtle green dot or tint. States outside the window are still fully selectable — just visually unmarked.

### Implementation

Reuse `STATE_TO_TZ` from Feature 2 (exported from `docs/usLocations.js`).

```js
function statesInCallWindow(windowStart = 9, windowEnd = 17) {
  const now = new Date();
  return Object.keys(window.STATE_TO_TZ || {}).filter((state) => {
    const h = parseInt(
      new Intl.DateTimeFormat("en-US", {
        timeZone: window.STATE_TO_TZ[state], hour: "numeric", hour12: false
      }).format(now),
      10
    );
    return h >= windowStart && h < windowEnd;
  });
}

function refreshCallWindowIndicators() {
  const inWindow = new Set(statesInCallWindow());
  document.querySelectorAll("#stateOptions .multiselect-option").forEach((el) => {
    const code = el.querySelector("input")?.value;
    el.classList.toggle("in-call-window", Boolean(code && inWindow.has(code)));
  });
}
```

Call `refreshCallWindowIndicators()` after state options render, and again every 5 minutes:
```js
refreshCallWindowIndicators();
setInterval(refreshCallWindowIndicators, 5 * 60 * 1000);
```

**CSS (`docs/style.css`):**
```css
.multiselect-option.in-call-window::before {
  content: "●";
  color: var(--score-high); /* reuse existing green token */
  font-size: 0.55em;
  margin-right: 0.35em;
  vertical-align: middle;
}
```

### Affected files

| File | Change |
|---|---|
| `docs/usLocations.js` | Export `STATE_TO_TZ` as `window.STATE_TO_TZ` |
| `docs/app.js` | `statesInCallWindow()`, `refreshCallWindowIndicators()`, `setInterval` |
| `docs/style.css` | `.in-call-window` indicator style |

---

## Summary

| # | Feature | Priority | Effort | Backend? | Schema? |
|---|---|---|---|---|---|
| 1 | Unified call mode — claim-on-chip-tap in prospect | P1 | Medium | No | No |
| 2 | Lead local time in call drawer | P2 | Low | No | No |
| 3 | Shuffle queue in call mode | P3 | Low | No | No |
| 4 | Admin default taxonomy | P2 | Medium | Yes | Yes |
| 5 | 9am States calling-window indicator | P3 | Low | No | No |
