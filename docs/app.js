// Adapted from backend/public/app.js for the Apps Script backend. Same UI
// and behavior as the Node version; only the request layer changed:
// - relative /api/... fetches -> APPS_SCRIPT_URL with a ?path= query param
//   (Apps Script Web Apps have no real router)
// - the shared access token goes in the query string, not an Authorization
//   header or the browser's native Basic Auth prompt, so requests stay CORS
//   "simple requests" and never trigger a preflight Apps Script can't answer
// - every response is HTTP 200; success/failure is the `success` field in
//   the JSON body, not the HTTP status

const TOKEN_STORAGE_KEY = "dmeProspectorToken";

function getToken() {
  let token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!token) {
    token = window.prompt("Enter the team access code:") || "";
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
  }
  return token;
}

function clearToken() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

async function apiGet(path, params = {}) {
  const query = new URLSearchParams(params);
  query.set("path", path);
  query.set("token", getToken());
  const res = await fetch(`${APPS_SCRIPT_URL}?${query.toString()}`);
  return unwrap(await res.json());
}

async function apiPost(path, body) {
  const query = new URLSearchParams({ path, token: getToken() });
  const res = await fetch(`${APPS_SCRIPT_URL}?${query.toString()}`, {
    method: "POST",
    // text/plain (not application/json) keeps this a CORS-simple request so
    // the browser never sends a preflight OPTIONS -- Apps Script parses the
    // body as JSON on its side regardless of the declared content type.
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  return unwrap(await res.json());
}

function unwrap(payload) {
  if (!payload.success) {
    if (payload.status === 401) clearToken(); // wrong/stale code -- ask again next time
    throw new Error(payload.error || "Request failed");
  }
  return payload.data;
}

const state = { companies: [], selected: new Set(), expandedIndex: null };

const els = {
  form: document.getElementById("searchForm"),
  searchBtn: document.getElementById("searchBtn"),
  resultsBody: document.getElementById("resultsBody"),
  resultsCount: document.getElementById("resultsCount"),
  selectAll: document.getElementById("selectAll"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),
  exportSheetsBtn: document.getElementById("exportSheetsBtn"),
  exportCsvLabel: document.getElementById("exportCsvLabel"),
  exportSheetsLabel: document.getElementById("exportSheetsLabel"),
  selectionChip: document.getElementById("selectionChip"),
  selectionCount: document.getElementById("selectionCount"),
  clearSelectionBtn: document.getElementById("clearSelectionBtn"),
  statusDot: document.querySelector(".status-dot"),
  statusText: document.getElementById("statusText"),
  toast: document.getElementById("toast"),
};

function setStatus(mode, text) {
  els.statusDot.className = `status-dot ${mode === "ready" ? "" : mode}`;
  els.statusText.textContent = text;
}

function showToast(message, isError = false, linkUrl = null) {
  els.toast.innerHTML = linkUrl
    ? `${message} — <a href="${linkUrl}" target="_blank" rel="noopener">open sheet</a>`
    : message;
  els.toast.className = `toast visible ${isError ? "error" : ""}`;
  setTimeout(() => { els.toast.className = "toast"; }, 5000);
}

function scoreTier(pct) {
  if (pct >= 65) return "high";
  if (pct >= 35) return "mid";
  return "low";
}

function scoreRing(score) {
  const pct = score?.percentage ?? 0;
  const tier = scoreTier(pct);
  const color = { high: "var(--score-high)", mid: "var(--score-mid)", low: "var(--score-low)" }[tier];
  const r = 16, c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return `
    <div class="score-ring">
      <svg width="40" height="40" viewBox="0 0 40 40">
        <circle class="track" cx="20" cy="20" r="${r}"></circle>
        <circle class="fill" cx="20" cy="20" r="${r}" stroke="${color}"
          stroke-dasharray="${c}" stroke-dashoffset="${offset}"></circle>
      </svg>
      <span class="label">${pct}</span>
    </div>`;
}

function buildSearchParams(formData) {
  const params = {};
  for (const [key, value] of formData.entries()) {
    if (value !== "" && value !== null) params[key] = value;
  }
  if (!formData.get("enrich")) params.enrich = "false";
  if (formData.get("scrape")) params.scrape = "true";
  return params;
}

async function runSearch(evt) {
  evt.preventDefault();
  const formData = new FormData(els.form);
  const params = buildSearchParams(formData);

  els.searchBtn.disabled = true;
  setStatus("busy", "Searching…");
  els.resultsBody.innerHTML = `<tr class="empty-row"><td colspan="7"><div class="loading-row"><span class="spinner"></span> Searching NPPES registry…</div></td></tr>`;

  try {
    const data = await apiGet("search/companies", params);

    state.companies = data.companies;
    state.selected.clear();
    state.expandedIndex = null;
    renderResults(data.excludedAsClaimed || 0);
    setStatus("ready", "Ready");
  } catch (err) {
    els.resultsBody.innerHTML = `<tr class="empty-row"><td colspan="7">${err.message}</td></tr>`;
    setStatus("error", "Error");
    showToast(err.message, true);
  } finally {
    els.searchBtn.disabled = false;
  }
}

function renderResults(excludedAsClaimed = 0) {
  const { companies } = state;
  const excludedNote = excludedAsClaimed > 0 ? ` (${excludedAsClaimed} already claimed, filtered out)` : "";
  els.resultsCount.textContent = `${companies.length} lead${companies.length === 1 ? "" : "s"} found${excludedNote}`;
  els.exportCsvBtn.disabled = companies.length === 0;
  els.exportSheetsBtn.disabled = companies.length === 0;
  els.selectAll.checked = companies.length > 0 && state.selected.size === companies.length;

  if (companies.length === 0) {
    els.resultsBody.innerHTML = `<tr class="empty-row"><td colspan="7">No leads matched that search.</td></tr>`;
    updateSelectionUI();
    return;
  }

  els.resultsBody.innerHTML = companies.map((c, i) => rowHtml(c, i)).join("");
  attachRowHandlers();
  updateSelectionUI();
}

function updateSelectionUI() {
  const count = state.selected.size;
  els.selectionChip.hidden = count === 0;
  els.selectionCount.textContent = `${count} selected`;
  els.exportCsvLabel.textContent = count > 0 ? `Export ${count} selected` : "Export CSV";
  els.exportSheetsLabel.textContent = count > 0 ? `Send ${count} selected` : "Export to Sheets";
}

function rowHtml(company, index) {
  const primaryContact = company.decisionMakers?.[0];
  const isExpanded = state.expandedIndex === index;
  const isSelected = state.selected.has(index);
  const rows = [`
    <tr class="lead-row ${isSelected ? "is-selected" : ""}" data-index="${index}">
      <td onclick="event.stopPropagation()"><input type="checkbox" class="row-check" data-index="${index}" ${isSelected ? "checked" : ""}></td>
      <td>${scoreRing(company.score)}</td>
      <td>
        <div class="company-name">${escapeHtml(company.name)}</div>
        <div class="company-taxonomy">${escapeHtml(company.taxonomy?.description || "")}</div>
      </td>
      <td class="mono">${escapeHtml(company.address?.city || "")}, ${escapeHtml(company.address?.state || "")}</td>
      <td>${primaryContact ? escapeHtml(primaryContact.name) : '<span style="color:var(--muted)">—</span>'}</td>
      <td class="mono">${escapeHtml(company.phone || "—")}</td>
      <td><span class="chevron ${isExpanded ? "open" : ""}">▸</span></td>
    </tr>
  `];

  if (isExpanded) {
    rows.push(`
      <tr class="detail-row">
        <td colspan="7">
          <div class="detail-grid">
            <div class="detail-block">
              <h4>Details</h4>
              <div class="mono" style="font-size:13px; line-height:1.8;">
                NPI: ${escapeHtml(company.npi || "—")}<br>
                ${escapeHtml(company.address?.line1 || "")}<br>
                ${escapeHtml(company.address?.city || "")}, ${escapeHtml(company.address?.state || "")} ${escapeHtml(company.address?.postalCode || "")}<br>
                Website: ${company.website ? `<a href="${escapeHtml(company.website)}" target="_blank">${escapeHtml(company.website)}</a>` : "—"}<br>
                Fax: ${escapeHtml(company.fax || "—")}
              </div>
            </div>
            <div class="detail-block">
              <h4>Decision makers (${company.decisionMakers?.length || 0})</h4>
              ${(company.decisionMakers || []).map((dm) => `
                <div class="contact-item">
                  <div>
                    ${escapeHtml(dm.name)}${dm.title ? ` — ${escapeHtml(dm.title)}` : ""}
                    <span class="contact-role">${escapeHtml(dm.roleCategory)}</span>
                  </div>
                  ${dm.phone ? `<div class="mono contact-phone">${escapeHtml(dm.phone)}</div>` : ""}
                </div>
              `).join("") || '<span style="color:var(--muted); font-size:13px;">None identified</span>'}
            </div>
          </div>
          <div class="brief-box">
            <button class="btn btn-ghost btn-small" data-brief-index="${index}">Generate call brief</button>
            <div class="brief-output" id="brief-${index}"></div>
          </div>
        </td>
      </tr>
    `);
  }

  return rows.join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function attachRowHandlers() {
  document.querySelectorAll(".lead-row").forEach((row) => {
    row.addEventListener("click", () => {
      const idx = Number(row.dataset.index);
      state.expandedIndex = state.expandedIndex === idx ? null : idx;
      renderResults();
    });
  });

  document.querySelectorAll(".row-check").forEach((box) => {
    box.addEventListener("change", (e) => {
      const idx = Number(e.target.dataset.index);
      const row = e.target.closest(".lead-row");
      if (e.target.checked) { state.selected.add(idx); row?.classList.add("is-selected"); }
      else { state.selected.delete(idx); row?.classList.remove("is-selected"); }
      els.selectAll.checked = state.companies.length > 0 && state.selected.size === state.companies.length;
      updateSelectionUI();
    });
  });

  document.querySelectorAll("[data-brief-index]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      generateBrief(Number(btn.dataset.briefIndex));
    });
  });
}

async function generateBrief(index) {
  const company = state.companies[index];
  const output = document.getElementById(`brief-${index}`);
  output.className = "brief-output visible";
  output.textContent = "Generating brief…";

  try {
    const data = await apiPost("brief/generate", { company });
    output.textContent = data.brief;
  } catch (err) {
    output.textContent = `Could not generate brief: ${err.message}`;
  }
}

function getExportCompanies() {
  if (state.selected.size > 0) {
    return [...state.selected].map((i) => state.companies[i]);
  }
  return state.companies;
}

async function exportCsv() {
  const companies = getExportCompanies();
  setStatus("busy", "Exporting…");
  try {
    const data = await apiPost("export/csv", { companies });
    const blob = new Blob([data.csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = data.filename || `dme-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${companies.length} lead(s) to CSV`);
    setStatus("ready", "Ready");
  } catch (err) {
    showToast(err.message, true);
    setStatus("error", "Error");
  }
}

async function exportSheets() {
  const companies = getExportCompanies();
  setStatus("busy", "Sending to Sheets…");
  try {
    const data = await apiPost("export/sheets", { companies });
    showToast(`Added ${data.rowsAdded} row(s) to "${data.tab}"`, false, data.sheetUrl);
    setStatus("ready", "Ready");
  } catch (err) {
    showToast(err.message, true);
    setStatus("error", "Error");
  }
}

els.form.addEventListener("submit", runSearch);
els.selectAll.addEventListener("change", (e) => {
  document.querySelectorAll(".row-check").forEach((box) => {
    box.checked = e.target.checked;
    const idx = Number(box.dataset.index);
    const row = box.closest(".lead-row");
    if (e.target.checked) { state.selected.add(idx); row?.classList.add("is-selected"); }
    else { state.selected.delete(idx); row?.classList.remove("is-selected"); }
  });
  updateSelectionUI();
});
els.clearSelectionBtn.addEventListener("click", () => {
  state.selected.clear();
  els.selectAll.checked = false;
  document.querySelectorAll(".row-check").forEach((box) => { box.checked = false; });
  document.querySelectorAll(".lead-row").forEach((row) => row.classList.remove("is-selected"));
  updateSelectionUI();
});
els.exportCsvBtn.addEventListener("click", exportCsv);
els.exportSheetsBtn.addEventListener("click", exportSheets);
