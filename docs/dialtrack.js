/* Counts a tap on a phone number as a call.
   Reps don't always use the Call button: tapping the number in a row, in an opened card, on Today or
   in call mode opens the phone app the same way. Any phone link that belongs to a lead is recorded as a
   call (POST /leads/dial), which is what the call counts on Today and in Team activity read. A result
   logged soon after the tap is the same call.
   Leads in Prospect count too, claimed or not: every tap is kept by person and NPI (sql/029), so it is
   still counted once the lead goes through to the app, and a result logged after claiming is the same call.
   Loaded after app.js, callmode.js and today.js. */
(function () {
  "use strict";

  const SAME_TAP_MS = 120000; // the server ignores a second tap on one lead inside this window too
  const lastTap = new Map(); // npi -> when it was last sent
  let refreshTimer = null;

  // Which lead does this phone link belong to? "" when it isn't one.
  function npiFor(link) {
    if (link.dataset.npi) return link.dataset.npi;

    if (link.closest("#callDrawer")) {
      const current = window.dmeCall && window.dmeCall.current && window.dmeCall.current();
      return (current && current.npi) || "";
    }

    const todayRow = link.closest(".today-row");
    if (todayRow) return (todayRow.querySelector("[data-npi]") || {}).dataset?.npi || "";

    if (link.closest("#resultsBody")) { // Prospect: the company in that row (or the row above an opened card)
      let row = link.closest("tr");
      if (row && row.classList.contains("detail-row")) row = row.previousElementSibling;
      const index = row && row.dataset.index;
      if (index !== undefined) return String((state.companies[Number(index)] || {}).npi || "");
    }

    if (link.closest("#claimedBody")) {
      let row = link.closest("tr");
      if (row && row.classList.contains("detail-row")) row = row.previousElementSibling;
      const index = row && row.dataset.claimedIndex;
      if (index !== undefined) return (state.claimedLeads[Number(index)] || {}).npi || "";
    }
    return "";
  }

  function remember(npi, notes) {
    const lead = (state.claimedLeads || []).find((l) => l.npi === npi);
    if (lead && notes !== undefined) lead.notes = notes;
  }

  // The goal ring and call counts on Today catch up a moment later.
  function refreshTodaySoon() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (state.view === "today" && window.dmeToday) window.dmeToday.refresh();
    }, 1500);
  }

  document.addEventListener("click", (e) => {
    const link = e.target.closest && e.target.closest('a[href^="tel:"]');
    if (!link || !getSession()) return;
    const npi = npiFor(link);
    if (!npi) return;

    const now = Date.now();
    if (now - (lastTap.get(npi) || 0) < SAME_TAP_MS) return;
    lastTap.set(npi, now);

    let number = link.getAttribute("href").slice(4);
    try { number = decodeURIComponent(number); } catch { /* keep it as written */ }
    // Fire and forget: the phone app opens either way, and a failure here must never get in the way of a call.
    apiPost("leads/dial", { npi, number })
      .then((result) => { if (result.logged) { remember(npi, result.notes); refreshTodaySoon(); } })
      .catch((err) => console.log("[dial] " + err.message));
  }, true);
})();
