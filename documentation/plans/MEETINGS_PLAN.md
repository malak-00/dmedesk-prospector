# Meetings for claimed leads

Status: first slice built. **Worker deployed (2026-10-05); SQL not yet run;
frontend not yet pushed.** Remaining: run `sql/020_lead_meetings.sql` in the
Supabase project the Worker uses, then push the frontend (before the SQL, the
Book a meeting button would show "not installed yet").

## What a rep can do now

From a Claimed lead's card, **Book a meeting** records one upcoming meeting:

- date and time, and length (15 minutes to 2 hours);
- how long before to be reminded (15 minutes to 2 days, or none);
- the contact's email (optional, prefilled from the lead's email if known);
- **opener notes**: the rep's private opening line, talking points and
  questions (up to 2,000 characters).

Saving can also set the lead's status to `meeting booked`. Every booking or
cancellation is written into the call log, so a rescheduled meeting keeps a
trail. The booked meeting shows in the card (with the opener notes in a
highlighted box), as a badge in the Reminder column, and as a browser
notification when the reminder moment arrives (same opt-in "Notify me for due
reminders" switch as callbacks; works while the app is open in a tab).

**Email confirmation** opens the rep's own mail program with a prefilled
message (`mailto:`). Nothing is sent from the app and no calendar invite is
created.

## Design decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Where it is stored | Five nullable columns on `leads` | Same place as `notes`, `status` and `reminder_at`; it is the owner's working data. No joins, no new RLS surface. |
| How many meetings | One upcoming per lead | Matches how reps work a lead. History lives in the call log. A `lead_meetings` table is the upgrade path if several are needed. |
| Privacy on reassignment | Trigger clears the columns when `claimed_by` changes | Opener notes and contact email must not pass to the next owner. A trigger survives re-running `013_release_claimed_leads.sql` and also covers admin conflict resolution. |
| Reminder | Computed as `meeting_at - meeting_remind_before_min` in the browser | `reminder_at` stays free for callbacks; the two do not overwrite each other. |
| Validation | `worker/src/lib/meetings.js` (unit tested) and matching check constraints | The app and a direct database write enforce the same bounds. |
| Existing Google Calendar booking | Left in place, not shown in the card | `POST /leads/book-meeting` needs a configured calendar and a lead email. It can be offered later as "also send an invite". |

## Order of deployment (manual)

1. Review `sql/020_lead_meetings.sql`, run it in the Supabase SQL Editor, and
   run its verification queries. It is additive and rerun-safe.
2. Deploy the Worker (`POST /leads/meeting`). Before step 1 it answers 503
   "Meetings aren't installed yet".
3. Push the frontend.

## Not built yet (ideas, in rough priority)

- Today's meetings strip above the Claimed table, next to overdue callbacks.
- Meeting outcome: after the time passes, ask "How did it go?" and log it.
- Several meetings per lead (`lead_meetings` table).
- Optional Google Calendar invite using the existing `GoogleCalendar.bookMeeting`.
- Meeting reminders by email (needs a sender; the app only reminds while open).
- Teammate visibility, if the team wants a shared meetings view.
