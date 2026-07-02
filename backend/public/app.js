const state = { companies: [], selected: new Set(), expandedIndex: null };

const els = {
  form: document.getElementById("searchForm"),
  searchBtn: document.getElementById("searchBtn"),
  resultsBody: document.getElementById("resultsBody"),
  resultsCount: document.getElementById("resultsCount"),
  selectAll: document.getElementById("selectAll"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),
  exportSheetsBtn: document.getElementById("exportSheetsBtn"),
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

function buildQuery(formData) {
  const params = new URLSearchParams();
  for (const [key, value] of formData.entries()) {
    if (value !== "" && value !== null) params.set(key, value);
  }
  if (!formData.get("enrich")) params.set("enrich", "false");
  if (formData.get("scrape")) params.set("scrape", "true");
  return params.toString();
}

async function runSearch(evt) {
  evt.preventDefault();
  const formData = new FormData(els.form);
  const query = buildQuery(formData);

  els.searchBtn.disabled = true;
  setStatus("busy", "Searching…");
  els.resultsBody.innerHTML = `<tr class="empty-row"><td colspan="7">Searching NPPES registry…</td></tr>`;

  try {
    const res = await fetch(`/api/search/companies?${query}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message || "Search failed");

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
  els.selectAll.checked = false;

  if (companies.length === 0) {
    els.resultsBody.innerHTML = `<tr class="empty-row"><td colspan="7">No leads matched that search.</td></tr>`;
    return;
  }

  els.resultsBody.innerHTML = companies.map((c, i) => rowHtml(c, i)).join("");
  attachRowHandlers();
}

function rowHtml(company, index) {
  const primaryContact = company.decisionMakers?.[0];
  const isExpanded = state.expandedIndex === index;
  const rows = [`
    <tr class="lead-row" data-index="${index}">
      <td onclick="event.stopPropagation()"><input type="checkbox" class="row-check" data-index="${index}"></td>
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
                  ${escapeHtml(dm.name)}${dm.title ? ` — ${escapeHtml(dm.title)}` : ""}
                  <span class="contact-role">${escapeHtml(dm.roleCategory)}</span>
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
      if (e.target.checked) state.selected.add(idx); else state.selected.delete(idx);
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
    const res = await fetch("/api/brief/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || "Brief generation failed");
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
    const res = await fetch("/api/export/csv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companies }),
    });
    if (!res.ok) throw new Error("Export failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dme-leads-${new Date().toISOString().slice(0, 10)}.csv`;
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
    const res = await fetch("/api/export/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companies }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || "Sheets export failed");
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
    if (e.target.checked) state.selected.add(idx); else state.selected.delete(idx);
  });
});
els.exportCsvBtn.addEventListener("click", exportCsv);
els.exportSheetsBtn.addEventListener("click", exportSheets);