// Web App entry point -- Apps Script only supports doGet/doPost, no real
// router, so every request carries a `path` query param (e.g.
// ?path=search/companies) that this file dispatches on. This mirrors the
// Express routes in backend/src/routes/*.js one-for-one.
//
// IMPORTANT DIFFERENCE FROM THE NODE APP: Apps Script Web Apps cannot return
// a custom HTTP status code (no 401/503/502 etc.) -- every response is
// HTTP 200. Callers must check the `success` field in the JSON body instead
// of the HTTP status. `status` in the body is a logical status carried over
// from the Node error convention (400/401/502/503/504), not a real HTTP code.
//
// AUTH: the shared APP_TOKEN must be passed as a `token` query parameter on
// every request (GET and POST alike), not an Authorization header. Custom
// headers force the browser into a CORS preflight (OPTIONS) request, which
// Apps Script Web Apps don't handle -- keeping auth in the query string keeps
// every request a CORS "simple request" so preflight never happens.

function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function handleRequest_(e) {
  var params = (e && e.parameter) || {};
  var path = params.path || "";

  try {
    if (path !== "health") checkAuth_(params);

    switch (path) {
      case "health":
        return jsonResponse_({ success: true, data: { name: "DME Desk Prospector", status: "running" } });

      case "search/nppes":
        return jsonResponse_({ success: true, data: NppesService.searchProviders(readSearchCriteria_(params)) });

      case "search/companies":
        return jsonResponse_({
          success: true,
          data: CompanyService.searchCompanies(readSearchCriteria_(params), {
            enrichPlaces: params.enrich !== "false",
            scrapeWebsites: params.scrape === "true",
          }),
        });

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
        return jsonResponse_({ success: true, data: SheetsStore.exportCompaniesToSheet(sheetsBody.companies) });
      }

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
    if (err.message === "Not authorized") {
      return errorResponse_(401, err.message);
    }
    console.log("[Code] Unhandled error on path \"" + path + "\": " + err.message);
    return errorResponse_(err.status || 500, err.message || "Internal Server Error");
  }
}

function checkAuth_(params) {
  var expected = Config.appToken();
  if (!expected) {
    // Not configured at all -- fail closed rather than silently running open,
    // since this Web App is reachable by anyone who has the URL.
    var notConfigured = new Error("APP_TOKEN is not configured on the server");
    notConfigured.name = "AuthNotConfiguredError";
    throw notConfigured;
  }
  if (params.token !== expected) {
    throw new Error("Not authorized");
  }
}

function readSearchCriteria_(params) {
  return {
    organizationName: params.organizationName || undefined,
    nameContains: params.nameContains || undefined,
    city: params.city || undefined,
    state: params.state || undefined,
    postalCode: params.postalCode || undefined,
    taxonomyDescription: params.taxonomyDescription || undefined,
    limit: params.limit ? Number(params.limit) : undefined,
    skip: params.skip ? Number(params.skip) : undefined,
  };
}

// POST bodies are sent as text/plain (not application/json) specifically to
// stay a CORS-simple-request and avoid preflight -- parse it as JSON here
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
