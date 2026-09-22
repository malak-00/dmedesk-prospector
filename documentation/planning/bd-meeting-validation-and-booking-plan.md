# BD Meeting Validation and Immediate Booking Plan

Date: 2026-09-22

**Status:** Working plan; several implementation items are now present, but
manual verification and rollout checks remain. See `operations/WORKLOG.md`.

## Objective

Make the BD Meetings workflow prevent invalid lead movements, allow a prospector user to book a meeting immediately from a claimed lead, and standardize meeting hyperlinks to a compact weekday/time label such as:

`[**Tue 9:30 PM**](https://calendar.google.com/calendar/u/0/r/eventedit/...)`

The event URL remains clickable; only the displayed text changes.

## Current findings

- `BD MEETINGS 2026/src/code.js` queues row movements in `onEdit`, maps `Rescheduled` to `New Meetings`, schedules checked rows in `scheduleSelectedMeetings`, and syncs calendar events into the meeting-date column in `syncMeetingTimeFromCalendar`.
- The spreadsheet uses the schedule checkbox in column Q and NPI in column Q-related sync fields as defined by the current script configuration; the exact validation columns must be confirmed against the live header row before implementation.
- `dmedesk-prospector/worker/` is the live API and already has authenticated claimed-lead routes, shared Google OAuth configuration, and Google Sheets integration. It has no Google Calendar booking route yet.
- `dmedesk-prospector/docs/app.js` renders claimed leads and handles status/notes/reminders, so it is the natural place for an immediate-booking action.
- The current spreadsheet fallback link is `https://www.google.com/calendar/event?eid=...`; the preferred fallback is the modern `calendar.google.com/calendar/u/0/r/eventedit/...` form, while an API-provided `htmlLink` should remain preferred when available.

## Implementation phases

### 1. Spreadsheet movement validation

- Add a guarded transition for `Rescheduled` → `NI` (case-insensitive, using the configured status names).
- Before the movement is committed, show a clear warning that `NI` means the meeting was never actually scheduled. Cancel the movement unless the user confirms.
- Add the same confirmation/guard to any equivalent movement path, including multi-row paste or queued movement processing, so the warning cannot be bypassed accidentally.
- Preserve the existing 10-second movement buffer and duplicate checks.

### 2. Spreadsheet required-field warning

- When a user attempts to schedule or move a lead into a meeting-qualified state, validate both required inputs:
  - the schedule checkbox is checked;
  - the NPI field is populated and valid.
- Show one warning identifying exactly which field is missing. Do not create an event, sync the lead, or complete the protected movement until the user fixes it.
- Reuse one validation helper from edit handling, scheduling, and any batch/paste path to avoid inconsistent rules.
- Confirm the live header names/columns before coding; do not rely only on the current hard-coded column comments.

### 3. Immediate booking in dmedesk-prospector

- Add a `Book meeting` action to each eligible claimed lead in the Claimed Leads UI.
- Add an authenticated Worker endpoint that accepts the lead identity plus meeting start time and duration, re-fetches the lead under the current user's ownership, validates the email/time, and creates the Google Calendar event through the existing OAuth configuration.
- Use a 30-minute default matching the spreadsheet scheduler, with an explicit duration in the API contract so it can be changed safely later.
- Invite the lead and the appropriate internal attendees only from server-side configuration; never accept arbitrary guest lists from the browser.
- Return the created event ID, canonical event URL, start time, and a display label. Record the booking result in the existing lead-note/audit path if the current schema supports it; otherwise document the smallest required schema addition before implementation.
- Make the endpoint idempotent or detect a recent matching booking so double-clicks do not create duplicate meetings.

### 4. Shared meeting-link formatting

- Centralize formatting in a small utility used by both the calendar sync writer and the booking response/UI.
- Format in the spreadsheet timezone and use `EEE h:mm a` (for example `Tue 9:30 PM`), omitting the date/year by design.
- Prefer the Calendar API `htmlLink` when present. Otherwise generate the modern event-edit URL from the event ID and calendar ID, with correct URL-safe/base64 encoding.
- Write rich text rather than plain text wherever the spreadsheet stores the meeting value.
- Keep the full date/time available in event metadata, tooltip, API data, or confirmation messaging so the compact label does not create ambiguity across weeks.

### 5. Verification and rollout

- Add static/unit coverage for transition validation, required-field validation, display formatting, URL generation, ownership checks, and duplicate-booking protection.
- Run safe local checks and inspect the generated Apps Script bundle/source; do not use automated browser testing.
- Deploy the Worker/frontend only after the user reviews the endpoint/configuration changes.
- Manually test: valid booking, missing email, non-owned lead, double-click, Rescheduled → NI cancellation/confirmation, unchecked schedule box, missing NPI, and the final rich-text hyperlink.

## Decisions/assumptions to confirm during implementation

1. `NI` means “Not Interested” and must be blocked behind confirmation only when reached from `Rescheduled`; other NI transitions retain current behavior unless requested otherwise.
2. “NPI field” means the lead's required NPI value in the spreadsheet and the claimed lead's NPI in Prospector.
3. Immediate booking means creating the Google Calendar event server-side, not only opening a prefilled `eventedit` URL.
4. Default meeting length is 30 minutes, matching the existing Apps Script scheduler.
5. The current Google OAuth account/calendar and attendee policy will be reused; no new calendar account is introduced by this plan.

## Out of scope

- Rebuilding the entire spreadsheet in Prospector.
- Broad lead-status redesign or automatic deletion/archiving.
- Production SQL/schema changes before the existing booking data model and audit requirements are confirmed.
