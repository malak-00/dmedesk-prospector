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
import * as Nppes from "./services/nppes.js";
import * as Cms from "./services/cms.js";
import * as Foursquare from "./services/foursquare.js";
import * as Scraper from "./services/scraper.js";
import * as AiBrief from "./services/aiBrief.js";
import * as CompanyService from "./services/companyService.js";
import * as CsvExport from "./lib/csvExport.js";
import * as GoogleSheets from "./services/googleSheets.js";

const app = new Hono();

app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type", "Authorization"], allowMethods: ["GET", "POST", "OPTIONS"] }));

function ok(data) {
  return { success: true, data };
}

// Attaches config/supabase/session to every request; throws 401 for
// anything not in PUBLIC_PATHS below (same gate Code.js's requireSession_
// applied before the switch statement).
const PUBLIC_PATHS = new Set(["/health", "/auth/login"]);

app.use("*", async (c, next) => {
  c.set("config", makeConfig(c.env));
  if (PUBLIC_PATHS.has(new URL(c.req.url).pathname)) return next();

  const authHeader = c.req.header("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : c.req.query("token");
  const session = await Auth.getSession(c.get("config"), token);
  if (!session) {
    return c.json({ success: false, status: 401, error: "Not signed in (or session expired)" }, 401);
  }
  c.set("session", session);
  return next();
});

// Central error handler -- mirrors Code.js's catch block, including the
// "*NotConfiguredError" -> 503 special case.
app.onError((err, c) => {
  if (["FoursquareNotConfiguredError", "GeminiNotConfiguredError", "SheetsNotConfiguredError", "AuthNotConfiguredError", "GoogleSheetsNotConfiguredError"].includes(err.name)) {
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

app.get("/health", (c) => c.json(ok({ name: "DME Desk Prospector", status: "running" })));

app.post("/auth/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const data = await Auth.login(c.get("config"), body.username, body.password);
  return c.json(ok(data));
});

app.post("/auth/logout", (c) => c.json(ok(Auth.logout())));

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
  };
}

function hasAnySearchCriteria(criteria) {
  return Boolean(
    criteria.npi ||
      criteria.organizationName ||
      criteria.nameContains ||
      (criteria.nameContainsTerms && criteria.nameContainsTerms.length) ||
      criteria.city ||
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
  const data = await Nppes.searchProviders(c.get("config"), criteria);
  return c.json(ok(data));
});

app.get("/search/companies", async (c) => {
  let criteria = readSearchCriteria(c);
  if (!hasAnySearchCriteria(criteria)) {
    return c.json({ success: false, status: 400, error: "At least one of NPI, company name, city, or specialty is required -- a state alone isn't specific enough for NPPES" }, 400);
  }
  criteria = await attachTaxonomyCodes(supabaseFor(c), criteria);
  const session = c.get("session");
  const data = await CompanyService.searchCompanies(c.get("config"), supabaseFor(c), criteria, {
    scrapeWebsites: c.req.query("scrape") === "true",
    requireCmsClaims: c.req.query("requireCmsClaims") === "true" || c.req.query("requireCmsClaims") === "on",
    userId: session.id,
    clientProvidedVariantSkips: Boolean(c.req.query("variantSkips")),
  });
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
// is what powers the app's own Claimed Leads view) -- this purely pastes a
// copy of the selected leads into the caller's "Claimed - <Name>" tab in
// the actual shared Google Sheet, for anyone who wants a spreadsheet view.
app.post("/export/google-sheet", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const data = await GoogleSheets.exportCompaniesToSheet(c.get("config"), body.companies, c.get("session"));
  return c.json(ok(data));
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

app.post("/leads/status", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const data = await leadsRepo.updateLeadStatus(supabaseFor(c), body.npi, body.status, c.get("session"));
  return c.json(ok(data));
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

// ---- debug ----------------------------------------------------------------

app.get("/debug/foursquare", async (c) => c.json(ok(await Foursquare.testConnection(c.get("config")))));

app.get("/debug/suggestion-email", (c) =>
  c.json(ok({ configured: false, note: "Suggestion email notifications aren't wired up in the Worker port -- suggestions are still stored in the `suggestions` table." }))
);

app.notFound((c) => c.json({ success: false, status: 404, error: "Unknown path: " + c.req.path }, 404));

export default app;
