# Prospector — Unconfirmed Suggestions

> These are ideas under consideration — **not yet approved for the plan.**
> Move to `FEATURE_PLAN.md` when confirmed.

---

## Suggestion A — Cooldown / Suppress-Today system

**Source:** DME Dialer §1.5 — Smart Filter / Cooldown
**Status:** Suggested (2026-10-06)

### The idea

After a rep encounters a fresh NPPES lead in Prospect mode (claims it, skips it, or just pages past it), suppress that lead from re-appearing for a configurable window — `4h / 8h / Today / Off`. Prevents a rep from accidentally dialling the same unclaimed lead twice in the same session.

### Why it is not in the plan yet

The Prospector's primary dedup mechanism is the claimed-lead system: once someone claims a lead it disappears from everyone else's Prospect results. For a solo rep, re-encountering the same unclaimed lead is possible but not frequent given NPPES result pagination. Worth revisiting if multi-rep scenarios make it a real pain point.

### Implementation sketch (if confirmed)

- Entirely client-side using `localStorage` — no Supabase changes needed.
- On each result returned, check if the NPI is in the local cooldown store.
- A settings toggle controls the window (`4h / 8h / Today / Off`).
- Key: `dmeProspectorCooldown` → `{ [npi]: expiresAtMs }`

---

## Suggestion B — Google Search shortcut per lead

**Source:** DME Dialer §1.3 — Google Search button
**Status:** Suggested (2026-10-06)

### The idea

A small "Google" icon link in each lead's detail row that opens:
`https://www.google.com/search?q=Company+Name+City+State+DME`

### Why it is not in the plan yet

The existing AI call brief (`Generate call brief`) already provides researched context on demand. The Google link is redundant for most use cases and adds visual noise to the detail row.

### Keep if

- Reps find the AI brief too slow and want a quick manual fallback.
- A detail row redesign creates space for it without clutter.
