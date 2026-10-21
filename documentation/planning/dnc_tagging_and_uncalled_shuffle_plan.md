# Plan: Uncalled Leads Filter & Shuffle, DNC Suppression, and Popular Tagging

## 1. Overview & Goals

This plan outlines the end-to-end implementation for three connected workflow improvements:
1. **"Call new leads only" Search Filter & Smart Shuffle**:
   - A checkbox in the search options row to only return leads with zero prior calls or contact.
   - A smart shuffle mechanism in Call Mode that specifically randomizes leads that haven't been called by an agent.
2. **"Do Not Call" (DNC) Designation & Suppression**:
   - When an agent designates a lead as "Do Not Call", it is recorded and permanently suppressed from future prospect searches so agents never see or dial it again.
   - The lead is immediately removed from the active view/queue in the browser.
3. **Prompted Tagging with Most Popular Tags**:
   - Marking a lead as DNC triggers a quick tag prompt (e.g., "Why is this Do Not Call?").
   - Shows the team's most frequently used / popular tags (e.g., *Wrong specialty*, *Closed business*, *Competitor*, *Hostile / Opt-out*, *Patient/Individual*) as one-click chips, with an option to type a custom tag.

---

## 2. Technical Design & Architecture

### A. Lead Call Tracking & "Call New Leads Only" Filter
- **Current State**:
  - `company.pickup` tracks `{ answered, total }` calls from team annotations.
  - `company.priorContact` tracks prior history if the lead was claimed/worked before.
- **Implementation**:
  - Add `[ ] Call new leads only` (`uncalledOnly`) checkbox to the search options in [`docs/index.html`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/docs/index.html) beside *"Start over from the beginning"*.
  - In [`docs/app.js`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/docs/app.js) and [`worker/src/services/companyService.js`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/worker/src/services/companyService.js): when active, filter out any lead where `company.pickup?.total > 0` or `company.priorContact != null`.
  - In [`docs/callmode.js`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/docs/callmode.js): update `reorderRest()` so that when shuffling, uncalled leads are randomized together at the front of the queue.

### B. "Do Not Call" (DNC) Suppression
- **Current State**:
  - Prospect searches in Supabase exclude leads where `(claimed_by is not null or is_disconnected = true)`.
  - Marking a prospect as DNC currently logs a note but does not mark `is_disconnected`.
- **Implementation**:
  - Designating a lead as "Do Not Call" (in Call Mode or from the lead card) routes it through the DNC flow:
    - Sets `status = 'do not call'`.
    - Marks `is_disconnected = true` (or exports to Disconnected) so it is excluded from future database searches for all agents.
    - Immediately calls `removeCompaniesFromProspect([item])` so the lead disappears instantly from the agent's current table and Call Mode queue.

### C. Prompted Tagging with Most Popular Tags
- **Current State**:
  - Tags are stored in Supabase table `lead_tags` (`npi`, `tag`, `user_id`, `created_at`).
  - [`docs/leadnotes.js`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/docs/leadnotes.js) has hardcoded suggestions (`good fit`, `wrong specialty`, etc.).
- **Implementation**:
  - **Backend API**: Add `GET /leads/annotations/popular-tags` in [`worker/src/index.js`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/worker/src/index.js) and [`worker/src/repos/annotationsRepo.js`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/worker/src/repos/annotationsRepo.js):
    - Queries `lead_tags`, groups by `tag`, orders by frequency count descending (cached for performance).
    - Falls back to sensible operational defaults if the table is new.
  - **Frontend Prompt**:
    - When "Do Not Call" is selected in Call Mode or on a lead card, display a prompt modal / inline chip picker:
      - Title: *"Tag this lead before marking Do Not Call"*
      - Displays top popular tags (e.g., *Wrong specialty*, *Closed*, *Competitor*, *Hostile*, *Not a business*) as clickable quick-chips.
      - Input field for custom tags.
      - Upon confirmation: saves the tag, saves DNC status, removes the lead from view, and advances to the next lead.

---

## 3. Step-by-Step Execution Plan

```
1. Add "[ ] Call new leads only" search checkbox and filter logic
   → verify: Search with box checked excludes leads with prior contact or calls.

2. Implement uncalled-lead shuffle in Call Mode
   → verify: Shuffling in Call Mode randomizes uncalled leads properly.

3. Backend: Implement popular tags aggregation endpoint
   → verify: GET /leads/annotations/popular-tags returns frequency-sorted tags.

4. Frontend: Build DNC designation & prompt flow with popular tags
   → verify: Selecting "Do Not Call" prompts for a tag with top chips, saves tag, and marks DNC.

5. Lead Suppression: Ensure DNC leads are permanently excluded from search
   → verify: A DNC-marked lead never appears in subsequent searches or Call Mode.
```

---

## 4. Detailed Component Changes

### 1. [`docs/index.html`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/docs/index.html)
- Add checkbox in `#searchForm .field-row`:
  ```html
  <label class="checkbox" title="Only show leads that have never been called or contacted by anyone on the team">
    <input type="checkbox" name="uncalledOnly">
    <span>Call new leads only</span>
  </label>
  ```

### 2. [`docs/app.js`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/docs/app.js)
- Include `uncalledOnly` in `buildSearchParams()`.
- Add client-side safety filter in `executeSearch()` and `applyCurrentPage()`: if `uncalledOnly` is checked, filter out companies that have `pickup?.total > 0` or `priorContact`.

### 3. [`docs/callmode.js`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/docs/callmode.js)
- Update `reorderRest()`:
  - Identify uncalled leads (`!item.pickup?.total && !item.priorContact` for prospects, or no call-log entries for claimed leads).
  - Shuffle uncalled leads and place them first.
- Update `saveClaimed` and `logProspect`:
  - When status is `"do not call"`, trigger the tag selection prompt before completing the save.
  - Call disconnect/suppression logic so the lead is removed from prospect view and queue.

### 4. [`docs/leadnotes.js`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/docs/leadnotes.js)
- Fetch and cache popular tags from `/leads/annotations/popular-tags`.
- Expose helper `window.dmeHooks.promptTag(npi, { reason: "dnc", onDone })` for modal/inline tag selection.

### 5. [`worker/src/repos/annotationsRepo.js`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/worker/src/repos/annotationsRepo.js) & [`worker/src/index.js`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/worker/src/index.js)
- Add `getPopularTags(supabase)`:
  - Aggregates `lead_tags` count by tag.
  - Returns top 8–10 most popular tags across the team.
- Expose endpoint `GET /leads/annotations/popular-tags`.

---

## 5. Verification & Testing

1. **Uncalled Leads Filter Verification**:
   - Run a search with *"Call new leads only"* unchecked: leads with "Contacted before" badge or call history appear.
   - Run the same search with *"Call new leads only"* checked: all leads with prior calls/notes are excluded.
2. **Shuffle Verification**:
   - Start Call Mode with a list of leads.
   - Toggle Shuffle: verify uncalled leads are shuffled and prioritized.
3. **DNC & Tagging Verification**:
   - In Call Mode, pick "Do Not Call".
   - Confirm tag prompt appears showing popular tags as chips.
   - Click a popular tag (e.g. "wrong specialty") and confirm.
   - Verify the tag is saved to `lead_tags`, lead is moved to DNC / Disconnected, and disappears from search results.
