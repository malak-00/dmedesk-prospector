// Web App entry point -- Apps Script only supports doGet/doPost, no real
// router, so every request carries a `path` query param (e.g.
// ?path=search/companies) that this file dispatches on.
//
// IMPORTANT DIFFERENCE FROM THE NODE APP: Apps Script Web Apps cannot return
// a custom HTTP status code -- every response is HTTP 200. Callers must
// check the `success` field in the JSON body instead of the HTTP status.
// `status` in the body is a logical status (400/401/502/503/504), not a
// real HTTP code.
//
// AUTH: users sign in with username/password (see AuthService and the
// "Users" tab in the Sheet); a successful login returns a session token
// that must be passed as a `token` query parameter on every request (GET
// and POST alike). Query-param rather than an Authorization header keeps
// every request a CORS "simple request" so the browser never sends a
// preflight OPTIONS, which Apps Script Web Apps don't handle.

function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

// One-time setup helper -- NOT called by the Web App itself. Select this
// function in the editor's function dropdown (top toolbar, next to Run) and
// click Run once: since it calls MailApp directly with nothing else in the
// way, Apps Script will show an "Authorization required" consent screen the
// first time (approve it) -- this is what actually grants the send_mail
// scope, unlike running doGet()/doPost() with no arguments, which fails at
// the sign-in check before ever reaching any code that uses MailApp, so it
// never prompts for this permission at all.
function grantMailAuthorization() {
  MailApp.sendEmail(
    Config.suggestionNotifyEmail(),
    "DME Desk Prospector -- authorization test",
    "If you're reading this, MailApp is authorized and suggestion emails will work from now on."
  );
}

var PUBLIC_PATHS_ = ["health", "auth/login"];

function handleRequest_(e) {
  var params = (e && e.parameter) || {};
  var path = params.path || "";

  try {
    var session = null;
    if (PUBLIC_PATHS_.indexOf(path) === -1) {
      session = requireSession_(params);
    }

    switch (path) {
      case "health":
        return jsonResponse_({ success: true, data: { name: "DME Desk Prospector", status: "running" } });

      case "auth/login": {
        var creds = readJsonBody_(e);
        return jsonResponse_({ success: true, data: AuthService.login(creds.username, creds.password) });
      }

      case "auth/logout":
        return jsonResponse_({ success: true, data: AuthService.logout(params.token) });

      case "auth/exclude-keywords": {
        var excludeKeywordsBody = readJsonBody_(e);
        return jsonResponse_({
          success: true,
          data: AuthService.setExcludeKeywords(params.token, excludeKeywordsBody.excludeKeywords),
        });
      }

      case "search/nppes": {
        var nppesCriteria = readSearchCriteria_(params);
        if (!hasAnySearchCriteria_(nppesCriteria)) {
          return errorResponse_(400, "At least one of NPI, organization name, city, or specialty is required -- a state alone isn't specific enough for NPPES");
        }
        return jsonResponse_({ success: true, data: NppesService.searchProviders(nppesCriteria) });
      }

      case "search/companies": {
        var companiesCriteria = readSearchCriteria_(params);
        if (!hasAnySearchCriteria_(companiesCriteria)) {
          return errorResponse_(400, "At least one of NPI, company name, city, or specialty is required -- a state alone isn't specific enough for NPPES");
        }
        return jsonResponse_({
          success: true,
          data: CompanyService.searchCompanies(companiesCriteria, {
            enrichPlaces: params.enrich !== "false",
            scrapeWebsites: params.scrape === "true",
            enrichCms: params.cms !== "false" || params.requireCmsClaims === "true" || params.requireCmsClaims === "on",
            requireCmsClaims: params.requireCmsClaims === "true" || params.requireCmsClaims === "on",
            username: session.username,
            // True only for an explicit "Search more" continuation (the
            // frontend already sent its own remembered variantSkips) -- a
            // plain fresh Search never does, which is exactly when
            // CompanyService should fall back to this user's persisted
            // SearchProgress bookmark instead of always restarting at skip 0.
            clientProvidedVariantSkips: Boolean(params.variantSkips),
          }),
        });
      }

      case "scrape/website":
        return jsonResponse_({ success: true, data: ScraperService.scrapeCompanyWebsite(params.url) });

      case "brief/generate": {
        var briefBody = readJsonBody_(e);
        if (!briefBody.company) return errorResponse_(400, "Request body must include a \"company\" object");
        return jsonResponse_({ success: true, data: { brief: AiBriefService.generateCallBrief(briefBody.company) } });
      }

      case "export/csv": {
        var csvBody = readJsonBody_(e);
        var csv = CsvExport.companiesToCsv(csvBody.companies);
        return jsonResponse_({ success: true, data: { csv: csv, filename: "leads.csv" } });
      }

      case "export/sheets": {
        var sheetsBody = readJsonBody_(e);
        return jsonResponse_({
          success: true,
          data: SheetsStore.exportCompaniesToSheet(sheetsBody.companies, session.displayName),
        });
      }

      case "export/disconnected": {
        var disconnectedBody = readJsonBody_(e);
        return jsonResponse_({
          success: true,
          data: SheetsStore.exportCompaniesToDisconnected(disconnectedBody.companies, session.displayName),
        });
      }

      case "leads/disconnect": {
        var disconnectBody = readJsonBody_(e);
        return jsonResponse_({
          success: true,
          data: SheetsStore.moveClaimedLeadsToDisconnected(disconnectBody.npis, session.displayName),
        });
      }

      case "leads/return-to-prospect": {
        var returnBody = readJsonBody_(e);
        return jsonResponse_({
          success: true,
          data: SheetsStore.returnClaimedLeadsToProspect(returnBody.npis),
        });
      }

      case "leads/list": {
        // Always scoped to the signed-in user's own claimed leads -- there's
        // no team-wide view anymore, not even via a raw query param, so this
        // is a real privacy boundary rather than just a UI default.
        var opts = { claimedBy: session.displayName };
        return jsonResponse_({
          success: true,
          data: { leads: SheetsStore.listClaimedLeads(opts), statuses: SheetsStore.getKnownStatuses() },
        });
      }

      case "leads/status": {
        var statusBody = readJsonBody_(e);
        return jsonResponse_({
          success: true,
          data: SheetsStore.updateLeadStatus(statusBody.npi, statusBody.status, session.displayName),
        });
      }

      case "leads/notes": {
        var notesBody = readJsonBody_(e);
        return jsonResponse_({
          success: true,
          data: SheetsStore.addLeadNote(notesBody.npi, notesBody.note, session.displayName),
        });
      }

      case "leads/notes/replace": {
        var replaceNotesBody = readJsonBody_(e);
        return jsonResponse_({
          success: true,
          data: SheetsStore.replaceLeadNotes(replaceNotesBody.npi, replaceNotesBody.notes),
        });
      }

      case "leads/reminder": {
        var reminderBody = readJsonBody_(e);
        return jsonResponse_({
          success: true,
          data: SheetsStore.setLeadReminder(reminderBody.npi, reminderBody.reminderAt, session.displayName),
        });
      }

      case "suggestions/submit": {
        var suggestionBody = readJsonBody_(e);
        return jsonResponse_({
          success: true,
          data: SheetsStore.addSuggestion(suggestionBody.text, session.displayName),
        });
      }

      case "taxonomies/list":
        return jsonResponse_({ success: true, data: { taxonomies: TaxonomyService.listEnabled() } });

      case "taxonomies/search":
        return jsonResponse_({ success: true, data: { results: TaxonomyService.search(params.q) } });

      case "taxonomies/enable": {
        var enableBody = readJsonBody_(e);
        return jsonResponse_({ success: true, data: { taxonomies: TaxonomyService.enable(enableBody.rowNumber) } });
      }

      case "debug/foursquare":
        return jsonResponse_({ success: true, data: FoursquareService.testConnection() });

      case "debug/suggestion-email":
        return jsonResponse_({ success: true, data: SheetsStore.testSuggestionEmail() });

      default:
        return errorResponse_(404, "Unknown path: " + path);
    }
  } catch (err) {
    if (
      err.name === "FoursquareNotConfiguredError" ||
      err.name === "GeminiNotConfiguredError" ||
      err.name === "SheetsNotConfiguredError" ||
      err.name === "AuthNotConfiguredError"
    ) {
      return errorResponse_(503, err.message);
    }
    console.log("[Code] Error on path \"" + path + "\": " + err.message);
    return errorResponse_(err.status || 500, err.message || "Internal Server Error");
  }
}

function requireSession_(params) {
  var session = AuthService.getSession(params.token);
  if (!session) {
    var unauthorized = new Error("Not signed in (or session expired)");
    unauthorized.status = 401;
    throw unauthorized;
  }
  return session;
}

// Prevents an all-blank query from silently paging through the entire
// national NPI-2 registry -- Node's controller already validates this; Apps
// Script's router didn't.
//
// `state`/`states` deliberately does NOT count on its own here: NPPES
// rejects a bare state (paired only with the enumeration_type=NPI-2 this app
// always sends) with "Field state requires additional search criteria" --
// it has to be paired with one of the fields below. Catching that
// client-side gives a clear, immediate message instead of a round-trip to
// NPPES for a rejection.
function hasAnySearchCriteria_(criteria) {
  return Boolean(
    criteria.npi || criteria.organizationName || criteria.nameContains ||
    (criteria.nameContainsTerms && criteria.nameContainsTerms.length) ||
    criteria.city ||
    criteria.taxonomyDescription || (criteria.taxonomyDescriptions && criteria.taxonomyDescriptions.length)
  );
}

// A comma-joined query param (e.g. "?states=FL,GA,TX") -> a clean array,
// dropping any blank segments. Empty input (param absent) returns [].
function parseCommaList_(value) {
  if (!value) return [];
  return String(value).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
}

// The "Search more" button's opaque per-variant resume-position map, sent
// back exactly as CompanyService returned it on the previous response.
function parseVariantSkips_(value) {
  if (!value) return {};
  try {
    var parsed = JSON.parse(value);
    return (parsed && typeof parsed === "object") ? parsed : {};
  } catch (err) {
    return {};
  }
}

function readSearchCriteria_(params) {
  return {
    npi: params.npi || undefined,
    organizationName: params.organizationName || undefined,
    nameContains: params.nameContains || undefined,
    nameContainsTerms: parseCommaList_(params.nameContainsTerms),
    city: params.city || undefined,
    state: params.state || undefined,
    states: parseCommaList_(params.states),
    taxonomyDescription: params.taxonomyDescription || undefined,
    taxonomyDescriptions: parseCommaList_(params.taxonomyDescriptions),
    lastUpdatedYear: params.lastUpdatedYear || undefined,
    lastUpdatedYears: parseCommaList_(params.lastUpdatedYears),
    excludeKeywords: parseCommaList_(params.excludeKeywords),
    limit: params.limit ? Number(params.limit) : undefined,
    skip: params.skip ? Number(params.skip) : undefined,
    variantSkips: parseVariantSkips_(params.variantSkips),
    excludeNpis: parseCommaList_(params.excludeNpis),
    requireCmsClaims: params.requireCmsClaims === "true" || params.requireCmsClaims === "on",
  };
}

// POST bodies are sent as text/plain (not application/json) specifically to
// stay a CORS-simple-request and avoid preflight -- parse as JSON here
// regardless of the declared content type.
function readJsonBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    var parseError = new Error("Request body must be valid JSON");
    parseError.status = 400;
    throw parseError;
  }
}

function jsonResponse_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function errorResponse_(status, message) {
  return jsonResponse_({ success: false, status: status, error: message });
}
