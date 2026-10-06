// Cloudflare Worker entry point, replacing appscript/Code.js's doGet/doPost
// dispatcher with real routes on a real HTTP server (Hono). Response body
// shape is kept identical to the old Apps Script responses on purpose --
// { success: true, data } or { success: false, status, error } -- so
// docs/app.js's existing unwrap() needed zero changes; only apiGet/apiPost
// (the fetch call itself) were updated to hit real paths with a real
// Authorization header instead of Apps Script's ?path=&token= workaround.
// Unlike Apps Script, this also sends REAL HTTP status codes matching
// `status`, since Cloudflare Workers (unlike Apps Script Web Apps) can.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { makeConfig } from "./lib/config.js";
import { getSupabase } from "./lib/supabase.js";
import * as Auth from "./lib/auth.js";
import * as leadsRepo from "./repos/leadsRepo.js";
import * as taxonomiesRepo from "./repos/taxonomiesRepo.js";
import * as suggestionsRepo from "./repos/suggestionsRepo.js";
import * as adminRepo from "./repos/adminRepo.js";
import * as Nppes from "./services/nppes.js";
import * as ProviderSearch from "./services/providerSearch.js";
import * as ProviderSource from "./services/providerSource.js";
import * as SearchCompare from "./services/searchCompare.js";
import * as Cms from "./services/cms.js";
import * as Foursquare from "./services/foursquare.js";
import * as Scraper from "./services/scraper.js";
import * as AiBrief from "./services/aiBrief.js";
import * as CompanyService from "./services/companyService.js";
import * as CsvExport from "./lib/csvExport.js";
import * as GoogleSheets from "./services/googleSheets.js";
import * as GoogleCalendar from "./services/googleCalendar.js";
import * as SearchInsights from "./services/searchInsights.js";
import * as userAdminRepo from "./repos/userAdminRepo.js";
import * as SystemInfo from "./services/systemInfo.js";
import { loadUserFlags, applyUserFlags } from "./lib/userGate.js";
import { readAdvancedCriteria, usesAdvancedSearch } from "./lib/searchFilters.js";
import { parseListParams } from "./lib/leadView.js";
import { applySourceTrial, SOURCE_HEADER } from "./lib/sourceTrial.js";

const app = new Hono();

app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type", "Authorization", SOURCE_HEADER], allowMethods: ["GET", "POST", "OPTIONS"] }));

function ok(data) {
  return { success: true, data };
}

// Attaches config/supabase/session to every request; throws 401 for
// anything not in PUBLIC_PATHS below (same gate Code.js's requireSession_
// applied before the switch statement).
const PUBLIC_PATHS = new Set(["/health", "/auth/login"]);
// All a person with a temporary password may do until they pick their own.
const PASSWORD_CHANGE_PATHS = new Set(["/auth/change-password", "/auth/logout"]);

app.use("*", async (c, next) => {
  c.set("config", makeConfig(c.env));
  if (PUBLIC_PATHS.has(new URL(c.req.url).pathname)) return next();

  const authHeader = c.req.header("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : c.req.query("token");
  const session = await Auth.getSession(c.get("config"), token);
  if (!session) {
    return c.json({ success: false, status: 401, error: "Not signed in (or session expired)" }, 401);
  }
  // A removed user stops working within seconds, and a changed admin flag applies
  // at once, instead of waiting for the sign-in token to expire.
  const gate = applyUserFlags(session, await loadUserFlags(getSupabase(c.get("config"))));
  if (!gate.ok) return c.json({ success: false, status: 401, error: gate.reason }, 401);
  let live = gate.session;
  if (live.mustChangePassword && !PASSWORD_CHANGE_PATHS.has(new URL(c.req.url).pathname)) {
    // The flag may have been cleared in another Worker instance a moment ago: look again, fresh.
    const again = applyUserFlags(session, await loadUserFlags(getSupabase(c.get("config")), Date.now, { fresh: true }));
    if (again.ok) live = again.session;
    if (live.mustChangePassword) {
      return c.json({ success: false, status: 403, error: "Change your password first: you are using a temporary one." }, 403);
    }
  }
  c.set("session", live);

  // An admin can opt in to searching DME Desk's own provider table while
  // everyone else stays on the configured source. See lib/sourceTrial.js.
  const trial = applySourceTrial(c.get("config"), live, c.req.header(SOURCE_HEADER));
  c.set("config", trial.config);
  c.set("sourceTrial", trial.trial);
  return next();
});

// Central error handler -- mirrors Code.js's catch block, including the
// "*NotConfiguredError" -> 503 special case.
app.onError((err, c) => {
  if (["FoursquareNotConfiguredError", "GeminiNotConfiguredError", "SheetsNotConfiguredError", "AuthNotConfiguredError", "GoogleSheetsNotConfiguredError", "GoogleCalendarNotConfiguredError"].includes(err.name)) {
    return c.json({ success: false, status: 503, error: err.message }, 503);
  }
  console.log(`[worker] Error on ${c.req.method} ${c.req.path}: ${err.message}`);
  const status = err.status || 500;
  return c.json({ success: false, status, error: err.message || "Internal Server Error" }, status);
});

function supabaseFor(c) {
  return getSupabase(c.get("config"));
}

// ---- health & auth ----------------------------------------------------

app.get("/health", (c) => c.json(ok({ name: "BD Lead Prospector", status: "running" })));

app.post("/auth/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const data = await Auth.login(c.get("config"), body.username, body.password);
  return c.json(ok(data));
});

app.post("/auth/logout", (c) => c.json(ok(Auth.logout())));

app.post("/auth/change-password", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const data = await Auth.changePassword(supabaseFor(c), c.get("session"), body.currentPassword, body.newPassword);
  return c.json(ok(data));
});

app.post("/auth/exclude-keywords", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const data = await Auth.setExcludeKeywords(c.get("config"), c.get("session"), body.excludeKeywords);
  return c.json(ok(data));
});

// ---- search -------------------------------------------------------------

function parseCommaList(value) {
  if (!value) return [];
  return String(value).split(",").map((s) => s.trim()).filter(Boolean);
}

function parseVariantSkips(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readSearchCriteria(c) {
  const q = (name) => c.req.query(name);
  return {
    npi: q("npi") || undefined,
    organizationName: q("organizationName") || undefined,
    nameContains: q("nameContains") || undefined,
    nameContainsTerms: parseCommaList(q("nameContainsTerms")),
    city: q("city") || undefined,
    state: q("state") || undefined,
    states: parseCommaList(q("states")),
    taxonomyDescription: q("taxonomyDescription") || undefined,
    taxonomyDescriptions: parseCommaList(q("taxonomyDescriptions")),
    lastUpdatedYear: q("lastUpdatedYear") || undefined,
    lastUpdatedYears: parseCommaList(q("lastUpdatedYears")),
    excludeKeywords: parseCommaList(q("excludeKeywords")),
    limit: q("limit") ? Number(q("limit")) : undefined,
    skip: q("skip") ? Number(q("skip")) : undefined,
    variantSkips: parseVariantSkips(q("variantSkips")),
    excludeNpis: parseCommaList(q("excludeNpis")),
    requireCmsClaims: q("requireCmsClaims") === "true" || q("requireCmsClaims") === "on",
    minMedicareClaims: q("minMedicareClaims") ? Number(q("minMedicareClaims")) : undefined,
    // Quality filters, sort order, and text/phone lookup (sql/021).
    ...readAdvancedCriteria(q),
    // Which source this request reads from, so paging bookmarks are kept per source.
    source: ProviderSource.resolveSource(c.get("config")) === ProviderSource.DME_DESK ? "dmedesk" : undefined,
  };
}

function hasAnySearchCriteria(criteria) {
  return Boolean(
    criteria.npi ||
      criteria.organizationName ||
      criteria.nameContains ||
      (criteria.nameContainsTerms && criteria.nameContainsTerms.length) ||
      criteria.city ||
      criteria.lookupText ||
      criteria.lookupPhone ||
      criteria.zip ||
      criteria.taxonomyDescription ||
      (criteria.taxonomyDescriptions && criteria.taxonomyDescriptions.length)
  );
}

// fakeNPI's npi_records has taxonomy_code populated but not
// taxonomy_description (see worker/src/services/nppes.js), so specialty
// filtering has to go through the code. Our own `taxonomies` table has
// both, so resolve description(s) -> code(s) here before querying.
async function attachTaxonomyCodes(supabase, criteria) {
  if (!criteria.taxonomyDescription && !(criteria.taxonomyDescriptions && criteria.taxonomyDescriptions.length)) {
    return criteria;
  }
  const descriptions = criteria.taxonomyDescriptions && criteria.taxonomyDescriptions.length
    ? criteria.taxonomyDescriptions
    : [criteria.taxonomyDescription];
  const codeByDescription = await taxonomiesRepo.getCodesByDescriptions(supabase, descriptions);

  return Object.assign({}, criteria, {
    taxonomyCode: criteria.taxonomyDescription ? codeByDescription.get(criteria.taxonomyDescription) : undefined,
    taxonomyCodes: criteria.taxonomyDescriptions && criteria.taxonomyDescriptions.length
      ? criteria.taxonomyDescriptions.map((d) => codeByDescription.get(d))
      : undefined,
  });
}

app.get("/search/nppes", async (c) => {
  let criteria = readSearchCriteria(c);
  if (!hasAnySearchCriteria(criteria)) {
    return c.json({ success: false, status: 400, error: "At least one of NPI, organization name, city, or specialty is required -- a state alone isn't specific enough for NPPES" }, 400);
  }
  criteria = await attachTaxonomyCodes(supabaseFor(c), criteria);
  const data = await ProviderSource.searchProviders(c.get("config"), supabaseFor(c), criteria);
  return c.json(ok(Object.assign({ source: ProviderSource.resolveSource(c.get("config")) }, data)));
});

// The cutover check: run one search against both copies of NPPES and show
// what each returned. Nothing is written, and neither source is changed --
// it exists so the switch is flipped on evidence rather than on hope.
//
// What it reports is coverage, not page overlap: every provider the mirror
// returned is looked up by NPI in our own table (services/searchCompare.js).
// Intersecting the two pages would measure ordering instead -- the sources
// page differently, so two correct 50-row pages of the same 8,000 matches
// can share nothing at all.
app.get("/admin/search-compare", async (c) => {
  requireAdmin(c.get("session"));
  // A state alone is too broad for a rep's search but is exactly what an
  // admin wants to compare -- "does DME Desk have Virginia?" -- and the
  // comparison only ever reads one page.
  let criteria = readSearchCriteria(c);
  if (!hasAnySearchCriteria(criteria) && !criteria.state) {
    return c.json({ success: false, status: 400, error: "Give a search to compare: a state, NPI, company name, city or specialty" }, 400);
  }
  criteria = await attachTaxonomyCodes(supabaseFor(c), criteria);
  criteria = Object.assign({}, criteria, { limit: Number(c.req.query("limit")) || 50, skip: Number(c.req.query("skip")) || 0 });

  const config = c.get("config");
  const supabase = supabaseFor(c);
  const timed = async (run) => {
    const startedAt = Date.now();
    try {
      const result = await run();
      return { ok: true, ms: Date.now() - startedAt, count: result.count, countCapped: result.countCapped === true, results: result.results };
    } catch (err) {
      return { ok: false, ms: Date.now() - startedAt, error: err.message, count: 0, results: [] };
    }
  };

  const [mirror, dmedesk] = await Promise.all([
    timed(() => Nppes.searchProviders(config, criteria)),
    timed(() => ProviderSearch.searchProviders(supabase, criteria)),
  ]);

  const coverage = await SearchCompare.compareCoverage(supabase, mirror.results, criteria);

  return c.json(ok({
    activeSource: ProviderSource.resolveSource(config),
    criteria: { state: criteria.state || null, city: criteria.city || null, taxonomyCode: criteria.taxonomyCode || null,
                organizationName: criteria.organizationName || null, npi: criteria.npi || null,
                limit: criteria.limit, skip: criteria.skip },
    mirror: { ok: mirror.ok, error: mirror.error || null, ms: mirror.ms, count: mirror.count, countCapped: mirror.countCapped === true, returned: mirror.results.length },
    dmedesk: { ok: dmedesk.ok, error: dmedesk.error || null, ms: dmedesk.ms, count: dmedesk.count, countCapped: dmedesk.countCapped === true, returned: dmedesk.results.length },
    coverage,
  }));
});

// The quality filters, sorting and text/phone lookups run in DME Desk's own
// provider table. Quietly ignoring them against the mirror would hand back
// results that don't match what was asked for, so say so instead.
function mirrorCannotDo(c, criteria) {
  if (!usesAdvancedSearch(criteria)) return null;
  if (ProviderSource.resolveSource(c.get("config")) === ProviderSource.DME_DESK) return null;
  return c.json({ success: false, status: 400, error: "Quality filters, sorting and name/phone lookups need searches to read from DME Desk's own provider table (NPI_SOURCE=dmedesk)." }, 400);
}

app.get("/search/companies", async (c) => {
  let criteria = readSearchCriteria(c);
  if (!hasAnySearchCriteria(criteria)) {
    return c.json({ success: false, status: 400, error: "At least one of NPI, company name, city, or specialty is required -- a state alone isn't specific enough for NPPES" }, 400);
  }
  const refused = mirrorCannotDo(c, criteria);
  if (refused) return refused;
  criteria = await attachTaxonomyCodes(supabaseFor(c), criteria);
  const session = c.get("session");
  const data = await CompanyService.searchCompanies(c.get("config"), supabaseFor(c), criteria, {
    scrapeWebsites: c.req.query("scrape") === "true",
    requireCmsClaims: c.req.query("requireCmsClaims") === "true" || c.req.query("requireCmsClaims") === "on",
    userId: session.id,
    clientProvidedVariantSkips: Boolean(c.req.query("variantSkips")) && c.req.query("rescan") !== "true",
    rescan: c.req.query("rescan") === "true",
    resetProgress: c.req.query("resetProgress") === "true",
  });
  return c.json(ok(data));
});

// ---- search insights (sql/021) ---------------------------------------------

app.get("/search/capabilities", async (c) => {
  const data = await SearchInsights.getCapabilities(c.get("config"), supabaseFor(c));
  return c.json(ok({ ...data, trial: Boolean(c.get("sourceTrial")) }));
});

async function insightsCriteria(c) {
  const criteria = readSearchCriteria(c);
  return attachTaxonomyCodes(supabaseFor(c), criteria);
}

// Is the answer to "how many?" even meaningful for this search? A lookup is
// one business, and a request with no filters at all would just count the table.
function insightsNotApplicable(criteria) {
  if (criteria.npi || criteria.lookupText || criteria.lookupPhone) return { lookup: true };
  // The sort order is always sent (it defaults to "best fit first") and isn't a
  // filter, so it must not make an empty form look like a search.
  const { sortBy: _ignored, ...withoutSort } = criteria;
  const hasFilter = hasAnySearchCriteria(criteria) || (criteria.states && criteria.states.length) || criteria.state ||
    (criteria.lastUpdatedYears && criteria.lastUpdatedYears.length) || usesAdvancedSearch(withoutSort);
  return hasFilter ? null : { empty: true };
}

app.get("/search/insights", async (c) => {
  const caps = await SearchInsights.getCapabilities(c.get("config"), supabaseFor(c));
  if (!caps.advanced) return c.json({ success: false, status: 409, error: caps.reason }, 409);
  const criteria = await insightsCriteria(c);
  const skip = insightsNotApplicable(criteria);
  if (skip) return c.json(ok(skip));
  const data = await SearchInsights.getInsights(supabaseFor(c), c.get("session").id, criteria);
  return c.json(ok(data));
});

app.get("/search/quickpicks", async (c) => {
  const caps = await SearchInsights.getCapabilities(c.get("config"), supabaseFor(c));
  if (!caps.advanced) return c.json({ success: false, status: 409, error: caps.reason }, 409);
  const criteria = await insightsCriteria(c);
  const picks = await SearchInsights.getQuickPicks(supabaseFor(c), criteria);
  return c.json(ok({ picks }));
});

app.get("/search/territory", async (c) => {
  const caps = await SearchInsights.getCapabilities(c.get("config"), supabaseFor(c));
  if (!caps.advanced) return c.json({ success: false, status: 409, error: caps.reason }, 409);
  const data = await SearchInsights.getTerritory(supabaseFor(c));
  return c.json(ok(data));
});

app.get("/scrape/website", async (c) => {
  const data = await Scraper.scrapeCompanyWebsite(c.req.query("url"));
  return c.json(ok(data));
});

app.post("/brief/generate", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.company) return c.json({ success: false, status: 400, error: 'Request body must include a "company" object' }, 400);
  const brief = await AiBrief.generateCallBrief(c.get("config"), body.company);
  return c.json(ok({ brief }));
});

// ---- export / leads -------------------------------------------------------

app.post("/export/csv", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const csv = CsvExport.companiesToCsv(body.companies);
  return c.json(ok({ csv, filename: "leads.csv" }));
});

app.post("/export/sheets", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const data = await leadsRepo.exportCompaniesToLeads(supabaseFor(c), body.companies, c.get("session"), CsvExport.flattenCompany);
  return c.json(ok(data));
});

app.post("/export/disconnected", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const data = await leadsRepo.exportCompaniesToDisconnected(supabaseFor(c), body.companies, c.get("session"), CsvExport.flattenCompany);
  return c.json(ok(data));
});

// Separate from claiming (POST /export/sheets, which writes to Supabase and
// is what powers the app's own Claimed Leads view) -- this pastes a copy of
// the selected leads into the caller's "Claimed - <Name>" tab in the actual
// shared Google Sheet, for anyone who wants a spreadsheet view.
//
// It does not claim, but it does ask the same question claiming asks
// (sql/014's dry run): a lead a teammate owns, or one waiting on a Tier 2/3
// review, is refused rather than copied into a second rep's tab -- otherwise
// the spreadsheet would quietly disagree with who the app says owns what.
app.post("/export/google-sheet", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const session = c.get("session");
  const companies = (body.companies || []).filter((company) => company && company.npi);
  const preflight = await leadsRepo.preflightCompaniesForSheet(supabaseFor(c), companies, session, CsvExport.flattenCompany);

  const allowed = new Set(preflight.allowedNpis.map(String));
  const sendable = companies.filter((company) => allowed.has(String(company.npi)));
  const refused = {
    blocked: preflight.blocked,
    heldForReview: preflight.heldForReview,
    invalid: preflight.invalid,
  };
  if (sendable.length === 0) {
    return c.json(ok(Object.assign({ rowsAdded: 0, sentNpis: [], claimedBy: session.displayName }, refused)));
  }

  const data = await GoogleSheets.exportCompaniesToSheet(c.get("config"), sendable, session);
  return c.json(ok(Object.assign({}, data, { sentNpis: sendable.map((company) => String(company.npi)) }, refused)));
});

// Claimed leads view's own "Export to Sheet" -- takes NPIs (not a raw
// companies payload) and re-fetches them server-side, scoped to the
// caller's own claimed leads, same trust boundary as /leads/disconnect and
// /leads/return-to-prospect below.
app.post("/export/google-sheet/claimed", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const supabase = supabaseFor(c);
  const session = c.get("session");
  const leads = await leadsRepo.getClaimedLeadsByNpis(supabase, body.npis, session);
  const data = await GoogleSheets.exportLeadsToSheet(c.get("config"), leads, session);
  return c.json(ok(data));
});

app.post("/leads/disconnect", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const data = await leadsRepo.moveClaimedLeadsToDisconnected(supabaseFor(c), body.npis, c.get("session"));
  return c.json(ok(data));
});

app.post("/leads/return-to-prospect", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const data = await leadsRepo.returnClaimedLeadsToProspect(supabaseFor(c), body.npis, c.get("session"));
  return c.json(ok(data));
});

app.get("/leads/list", async (c) => {
  const supabase = supabaseFor(c);
  const session = c.get("session");
  const [leads, statuses] = await Promise.all([leadsRepo.listClaimedLeads(supabase, session), leadsRepo.getKnownStatuses(supabase)]);
  return c.json(ok({ leads, statuses }));
});

// One page of the rep's claimed leads, filtered and sorted here. Query: page, pageSize, status,
// q (search), overdue=1, states=FL,GA, sort (company|location|status|reminder|updated), dir, endOfDay.
app.get("/leads/page", async (c) => {
  const params = parseListParams(c.req.query());
  return c.json(ok(await leadsRepo.listClaimedPage(supabaseFor(c), c.get("session"), params)));
});

// The Today screen's lists and numbers. Query: start, end, week (ISO instants of the rep's own
// day and week), tz (the browser's getTimezoneOffset), staleDays.
app.get("/leads/today", async (c) => {
  const q = c.req.query();
  const now = Date.now();
  const at = (value, fallback) => (Number.isFinite(Date.parse(value)) ? Date.parse(value) : fallback);
  const days = Math.min(Math.max(Math.round(Number(q.staleDays)) || 14, 3), 90);
  const data = await leadsRepo.getTodayView(supabaseFor(c), c.get("session"), {
    nowMs: now,
    startOfDayMs: at(q.start, now - (now % 86_400_000)),
    endOfDayMs: at(q.end, now + 86_400_000),
    startOfWeekMs: at(q.week, now - 7 * 86_400_000),
    tzOffsetMin: Number.isFinite(Number(q.tz)) ? Number(q.tz) : 0,
    staleDays: days,
  });
  return c.json(ok(data));
});

// Callbacks that are due and meetings starting soon, for the browser's notifications.
app.get("/leads/due", async (c) => c.json(ok({ leads: await leadsRepo.getDueLeads(supabaseFor(c), c.get("session")) })));

app.post("/leads/status", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const data = await leadsRepo.updateLeadStatus(supabaseFor(c), body.npi, body.status, c.get("session"));
  return c.json(ok(data));
});

// A tap on the lead's phone number: logged as a call. Body: { npi, number }.
app.post("/leads/dial", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(ok(await leadsRepo.logDial(supabaseFor(c), body.npi, body.number, c.get("session"))));
});

app.post("/leads/notes", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const data = await leadsRepo.addLeadNote(supabaseFor(c), body.npi, body.note, c.get("session"));
  return c.json(ok(data));
});

app.post("/leads/notes/replace", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const data = await leadsRepo.replaceLeadNotes(supabaseFor(c), body.npi, body.notes, c.get("session"));
  return c.json(ok(data));
});

app.post("/leads/reminder", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const data = await leadsRepo.setLeadReminder(supabaseFor(c), body.npi, body.reminderAt, c.get("session"));
  return c.json(ok(data));
});

// The rep's own meeting plan for a lead: time, reminder lead time, contact
// email and private opener notes. Blank meetingAt cancels it.
app.post("/leads/meeting", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const data = await leadsRepo.setLeadMeeting(supabaseFor(c), body.npi, body, c.get("session"));
  return c.json(ok(data));
});

app.post("/leads/book-meeting", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const session = c.get("session");
  const lead = await leadsRepo.getOwnedLeadForBooking(supabaseFor(c), body.npi, session);
  const booking = await GoogleCalendar.bookMeeting(c.get("config"), lead, {
    startTime: body.startTime,
    durationMinutes: body.durationMinutes,
  });
  return c.json(ok({ npi: String(body.npi), ...booking }));
});

// ---- suggestions / taxonomies ---------------------------------------------

app.post("/suggestions/submit", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const data = await suggestionsRepo.addSuggestion(supabaseFor(c), body.text, c.get("session"));
  return c.json(ok(data));
});

app.get("/taxonomies/list", async (c) => {
  const taxonomies = await taxonomiesRepo.listEnabled(supabaseFor(c));
  return c.json(ok({ taxonomies }));
});

app.get("/taxonomies/search", async (c) => {
  const results = await taxonomiesRepo.search(supabaseFor(c), c.req.query("q"));
  return c.json(ok({ results }));
});

app.post("/taxonomies/enable", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const taxonomies = await taxonomiesRepo.enable(supabaseFor(c), body.rowNumber);
  return c.json(ok({ taxonomies }));
});

// ---- admin ------------------------------------------------------------

function requireAdmin(session) {
  if (!session.isAdmin) {
    const err = new Error("Admins only");
    err.status = 403;
    throw err;
  }
}

app.get("/admin/overview", async (c) => {
  const session = c.get("session");
  requireAdmin(session);
  const supabase = supabaseFor(c);
  const [users, suggestions, stats] = await Promise.all([
    adminRepo.getUserActivitySummary(supabase),
    suggestionsRepo.listAllSuggestions(supabase),
    adminRepo.getAggregateStats(supabase),
  ]);
  return c.json(ok({ users, suggestions, stats }));
});

// ---- admin controls: users and system -----------------------------------

app.get("/admin/users", async (c) => {
  requireAdmin(c.get("session"));
  return c.json(ok(await userAdminRepo.listUsers(supabaseFor(c))));
});

app.post("/admin/users", async (c) => {
  requireAdmin(c.get("session"));
  const body = await c.req.json().catch(() => ({}));
  return c.json(ok(await userAdminRepo.createUser(supabaseFor(c), body)));
});

app.post("/admin/users/update", async (c) => {
  const session = c.get("session");
  requireAdmin(session);
  const body = await c.req.json().catch(() => ({}));
  return c.json(ok(await userAdminRepo.updateUser(supabaseFor(c), session, body)));
});

app.get("/admin/system", async (c) => {
  requireAdmin(c.get("session"));
  return c.json(ok(await SystemInfo.getSystemInfo(c.get("config"), supabaseFor(c))));
});

// Choose (or clear, with an empty rowNumber) the specialty the search form starts with. Admin only.
app.post("/admin/taxonomies/default", async (c) => {
  requireAdmin(c.get("session"));
  const body = await c.req.json().catch(() => ({}));
  return c.json(ok({ taxonomies: await taxonomiesRepo.setDefault(supabaseFor(c), body.rowNumber || "") }));
});

// Every spelling of a status in use, and what each should become. Admin only.
app.get("/admin/statuses", async (c) => {
  requireAdmin(c.get("session"));
  return c.json(ok(await adminRepo.getStatusCleanup(supabaseFor(c))));
});

// Change statuses in bulk: { merges: [{ from, to }] }. Returns the leads it changed, for an undo file. Admin only.
app.post("/admin/statuses/merge", async (c) => {
  requireAdmin(c.get("session"));
  const body = await c.req.json().catch(() => ({}));
  return c.json(ok(await adminRepo.applyStatusMerges(supabaseFor(c), body.merges)));
});

// Claimed -> contacted -> meeting -> onboarded, by rep, specialty and state. Admin only.
app.get("/admin/funnel", async (c) => {
  requireAdmin(c.get("session"));
  return c.json(ok(await adminRepo.getFunnel(supabaseFor(c), { days: c.req.query("days") })));
});

// Active claimed leads (all, or one rep's) for the admin CSV export. Admin only.
app.get("/admin/export/leads", async (c) => {
  requireAdmin(c.get("session"));
  return c.json(ok({ leads: await adminRepo.getLeadsForExport(supabaseFor(c), { userId: c.req.query("userId") || "" }) }));
});

// Calls, meetings and claims per rep, by week. Admin only.
app.get("/admin/team-activity", async (c) => {
  requireAdmin(c.get("session"));
  const data = await adminRepo.getTeamActivity(supabaseFor(c), { weeks: c.req.query("weeks") });
  return c.json(ok(data));
});

// Identity groups whose active claims are split across more than one
// person. Read-only: every row here needs an explicit approved decision,
// so nothing is resolved automatically.
app.get("/admin/conflicts", async (c) => {
  requireAdmin(c.get("session"));
  const data = await adminRepo.getOwnershipConflicts(supabaseFor(c));
  return c.json(ok(data));
});

// Assigns one conflicted group to a single owner. The actual work happens
// in a SQL function (sql/005_ownership_conflict_resolution.sql) so the
// conflict check, the reassignment and the audit events are one
// transaction -- the approving admin is taken from the session, never from
// the request body.
app.post("/admin/conflicts/resolve", async (c) => {
  const session = c.get("session");
  requireAdmin(session);
  const body = await c.req.json().catch(() => ({}));
  const data = await adminRepo.resolveOwnershipConflict(supabaseFor(c), {
    groupId: body.groupId,
    toUserId: body.toUserId,
    approvedBy: session.id,
    reason: body.reason,
  });
  return c.json(ok(data));
});

// Claim leads on behalf of a named teammate, for integrations like BD
// MEETINGS that sign in with their own account. Deliberately NOT
// requireAdmin: the integration account shouldn't be an admin. The
// permission (admin or app_users.can_claim_for_others) is checked fresh in
// the repo, the teammate is looked up by exact username, and the caller is
// recorded as the actor on every claimed event.
// Body: { username: "<exact app username>", companies: [...] }
app.post("/admin/claim-for-user", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const data = await leadsRepo.claimForUser(
    supabaseFor(c),
    c.get("session"),
    { username: body.username, companies: body.companies, dryRun: body.dryRun === true },
    CsvExport.flattenCompany
  );
  return c.json(ok(data));
});

// Tier 2/3 identity matches waiting for an admin decision. Read-only.
// What the last NPPES refresh changed about claimed leads (sql/015). A rep
// sees their own as a badge in Claimed leads; this is the admin's full list,
// where a change that moves a lead's identity keys can be acted on before the
// group is re-cut -- groups are never re-cut automatically.
app.get("/admin/provider-changes", async (c) => {
  requireAdmin(c.get("session"));
  const data = await adminRepo.getProviderChanges(supabaseFor(c));
  return c.json(ok(data));
});

// "Seen, no action" (dismissed) or "acted on it" (approved). The alert itself
// is append-only, so the decision is recorded beside it, never on it.
app.post("/admin/provider-changes/resolve", async (c) => {
  const session = c.get("session");
  requireAdmin(session);
  const body = await c.req.json().catch(() => ({}));
  const data = await adminRepo.resolveProviderChange(supabaseFor(c), {
    eventId: body.eventId,
    decision: body.decision,
    reviewerId: session.id,
    note: body.note,
  });
  return c.json(ok(data));
});

app.get("/admin/match-reviews", async (c) => {
  requireAdmin(c.get("session"));
  const data = await adminRepo.getMatchReviews(supabaseFor(c));
  return c.json(ok(data));
});

// Merge (same business) or dismiss (not the same) one flagged pair. The
// deciding admin comes from the session, never the request body; the work
// is one SQL function (sql/009_identity_match_review.sql).
app.post("/admin/match-reviews/resolve", async (c) => {
  const session = c.get("session");
  requireAdmin(session);
  const body = await c.req.json().catch(() => ({}));
  const data = await adminRepo.resolveMatchReview(supabaseFor(c), {
    leftNpi: body.leftNpi,
    rightNpi: body.rightNpi,
    decision: body.decision,
    decidedBy: session.id,
    reason: body.reason,
    tier: body.tier,
    matchedKeys: body.matchedKeys,
  });
  return c.json(ok(data));
});

// Bulk merge is limited to ownership-safe pairs. The repo revalidates every
// pair and generates the audit reason from current database-backed owners.
app.post("/admin/match-reviews/bulk-merge", async (c) => {
  const session = c.get("session");
  requireAdmin(session);
  const body = await c.req.json().catch(() => ({}));
  const data = await adminRepo.bulkMergeEligibleMatchReviews(supabaseFor(c), {
    pairs: body.pairs,
    decidedBy: session.id,
  });
  return c.json(ok(data));
});

app.get("/admin/leads", async (c) => {
  const session = c.get("session");
  requireAdmin(session);
  const userId = c.req.query("userId");
  const displayName = c.req.query("displayName") || "";
  if (!userId) return c.json({ success: false, status: 400, error: "userId is required" }, 400);
  const leads = await leadsRepo.listClaimedLeadsForUser(supabaseFor(c), userId, displayName);
  return c.json(ok({ leads }));
});

// ---- debug ----------------------------------------------------------------

app.get("/debug/foursquare", async (c) => c.json(ok(await Foursquare.testConnection(c.get("config")))));

app.get("/debug/suggestion-email", (c) =>
  c.json(ok({ configured: false, note: "Suggestion email notifications aren't wired up in the Worker port -- suggestions are still stored in the `suggestions` table." }))
);

app.notFound((c) => c.json({ success: false, status: 404, error: "Unknown path: " + c.req.path }, 404));

export default app;
