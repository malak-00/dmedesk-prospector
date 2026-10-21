/* Call intel: a few structured fields a rep learns on a call, kept on the lead for the whole team (sql/050):
   who handles their billing today, the gatekeeper's name, the best direct line, an email, a rough size, and the main
   reason they gave for not signing. Shown on an opened Prospect card and in the call panel, for prospects and
   claimed leads alike. Each field saves when you leave it (GET/POST /leads/intel); the latest value wins.
   The call brief reads these too. Wired through window.dmeHooks; loaded after app.js. */
(function (root) {
  "use strict";

  const hooks = root.dmeHooks;
  if (typeof document === "undefined" || !hooks) return;

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const OBJECTIONS = ["price", "in-house", "happy with current", "bad timing", "not the decision maker", "no need", "other"];
  const capital = (v) => String(v || "").charAt(0).toUpperCase() + String(v || "").slice(1);

  const FIELDS = [
    { key: "currentBiller", label: "Current biller", placeholder: "In-house, or their company", type: "text", max: 80 },
    { key: "gatekeeper", label: "Gatekeeper", placeholder: "Who answers the phone", type: "text", max: 80 },
    { key: "directLine", label: "Best direct line", placeholder: "(555) 555-5555", type: "tel", max: 30 },
    { key: "email", label: "Email", placeholder: "name@company.com", type: "email", max: 120 },
    { key: "patientVolume", label: "Size", placeholder: "e.g. about 80 patients a month", type: "text", max: 60 },
  ];

  const data = new Map(); // npi -> { installed, ...values }
  const busy = new Set();

  function who(d) {
    return d && d.updatedBy ? `Last updated by ${esc(d.updatedBy)}` : "";
  }

  function bodyHtml(npi) {
    const d = data.get(npi);
    if (!d) return '<span class="muted-note">Loading…</span>';
    if (!d.installed) return '<span class="muted-note">Call intel is not set up yet. An admin needs to run sql/050_lead_intel.sql in Supabase.</span>';
    return `<div class="intel-grid">${FIELDS.map((f) => `
        <label class="intel-field"><span>${esc(f.label)}</span>
          <input type="${f.type}" maxlength="${f.max}" data-intel-field="${f.key}" value="${esc(d[f.key])}" placeholder="${esc(f.placeholder)}" autocomplete="off"></label>`).join("")}
        <label class="intel-field"><span>Main objection</span>
          <select data-intel-field="objection"><option value="">None heard</option>${OBJECTIONS.map((o) => `<option value="${esc(o)}"${d.objection === o ? " selected" : ""}>${esc(capital(o))}</option>`).join("")}</select></label>
      </div>
      <div class="intel-foot muted-note"><span class="intel-status" aria-live="polite">${who(d)}</span></div>`;
  }

  function paint(npi) {
    document.querySelectorAll(`.intel[data-intel-npi="${npi}"] .intel-body`).forEach((box) => {
      // Never rebuild a box someone is typing in.
      if (box.contains(document.activeElement) && /^(INPUT|SELECT)$/.test(document.activeElement.tagName)) return;
      box.innerHTML = bodyHtml(npi);
    });
  }

  async function load(npi, fresh) {
    if (!fresh && data.has(npi)) { paint(npi); return; }
    paint(npi);
    try {
      data.set(npi, await apiGet("leads/intel", { npi }));
    } catch (err) {
      console.log("[leadintel] " + err.message);
      if (!data.has(npi)) data.set(npi, { installed: true, currentBiller: "", gatekeeper: "", directLine: "", email: "", patientVolume: "", objection: "" });
    }
    paint(npi);
  }

  hooks.intelBlock = (npi) => (npi ? `<div class="intel" data-intel-npi="${esc(npi)}"><div class="intel-body">${bodyHtml(String(npi))}</div></div>` : "");
  hooks.intelOpened = (npi, fresh = true) => { if (npi) load(String(npi), fresh); };

  async function save(box, el) {
    const npi = box.dataset.intelNpi;
    const key = el.dataset.intelField;
    const before = data.get(npi) || {};
    if (String(before[key] || "") === String(el.value || "").trim()) return; // nothing changed
    const status = box.querySelector(".intel-status");
    if (busy.has(npi + key)) return;
    busy.add(npi + key);
    if (status) status.textContent = "Saving…";
    try {
      data.set(npi, await apiPost("leads/intel", { npi, fields: { [key]: el.value } }));
      if (status) status.textContent = "Saved";
      // Every other box for this lead (the card and the call panel) shows the same values.
      document.querySelectorAll(`.intel[data-intel-npi="${npi}"] [data-intel-field="${key}"]`).forEach((other) => { if (other !== el) other.value = data.get(npi)[key] || ""; });
    } catch (err) {
      if (status) status.textContent = "";
      el.value = before[key] || "";
      showToast(err.message, true);
    } finally {
      busy.delete(npi + key);
    }
  }

  document.addEventListener("change", (e) => {
    const el = e.target.closest && e.target.closest("[data-intel-field]");
    const box = el && el.closest(".intel");
    if (box) save(box, el);
  });

  // Enter saves a text field (same as leaving it); stops the call panel's own shortcuts seeing the key.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !e.target.matches || !e.target.matches("[data-intel-field]")) return;
    e.preventDefault();
    e.stopPropagation();
    e.target.blur();
  }, true);
})(typeof window !== "undefined" ? window : globalThis);
