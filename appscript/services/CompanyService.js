// Port of backend/src/services/company.service.js -- orchestrates
// NPPES -> dedup -> enrich (Foursquare) -> optionally scrape -> score -> sort.
//
// Note: unlike the long-lived Node process, each Web App request here
// generally runs as its own fresh execution, so the Node version's
// "hasWarnedNoKey / hasWarnedNoDedup" warn-once pattern isn't meaningful --
// every unconfigured-integration event is just logged directly instead.

var CompanyService = (function () {
  var NPPES_PAGE_SIZE = 200; // NPPES hard cap per request
  var NPPES_MAX_SKIP = 1000; // NPPES hard cap on pagination depth

  function buildNppesDecisionMaker(provider) {
    var off = provider.authorizedOfficial;
    if (!off || !off.lastName) return null;
    var name = [off.firstName, off.lastName].filter(Boolean).join(" ");
    return {
      name: name,
      title: off.title || null,
      roleCategory: RoleClassifier.classifyRole(off.title || "authorized official"),
      phone: off.phone || null,
      source: "nppes", // self-reported registration data -- high reliability
      sourceUrl: null,
    };
  }

  function fromNppesProvider(provider) {
    var nppesDM = buildNppesDecisionMaker(provider);
    return CompanyModel.createCompany({
      npi: provider.npi,
      name: provider.name,
      address: provider.address,
      phone: provider.phone,
      fax: provider.fax,
      taxonomy: provider.taxonomy,
      decisionMakers: nppesDM ? [nppesDM] : [],
      lastUpdated: provider.lastUpdated,
      sources: { nppes: true },
    });
  }

  // Looks up every company in ONE batched Foursquare call (UrlFetchApp.fetchAll)
  // instead of one serial round-trip per company -- the single biggest lever
  // on search latency, since Apps Script has no other form of concurrency.
  function applyPlacesEnrichment(companies) {
    var dataByNpi;
    try {
      dataByNpi = FoursquareService.enrichCompanies(companies);
    } catch (err) {
      if (err.name === "FoursquareNotConfiguredError") {
        console.log("[CompanyService] Places enrichment skipped: FOURSQUARE_SERVICE_API_KEY not set");
      } else {
        console.log("[CompanyService] Places enrichment failed: " + err.message);
      }
      return companies;
    }

    return companies.map(function (company) {
      var data = company.npi != null ? dataByNpi[String(company.npi)] : null;
      if (!data) return company;

      return Object.assign({}, company, {
        website: data.website != null ? data.website : company.website,
        phone: company.phone || data.phone || null,
        places: {
          placeId: data.placeId,
          rating: data.rating,
          ratingCount: data.ratingCount,
          isClosed: data.isClosed,
        },
        sources: Object.assign({}, company.sources, { places: true }),
      });
    });
  }

  // Runs only when Foursquare didn't find a website -- OpenStreetMap often
  // has one for small local businesses that Foursquare's dataset misses.
  function tryEnrichWithOsm(company) {
    if (company.website) return company;
    try {
      var website = OsmService.lookupWebsite(company);
      if (!website) return company;
      return Object.assign({}, company, {
        website: website,
        sources: Object.assign({}, company.sources, { osm: true }),
      });
    } catch (err) {
      console.log("[CompanyService] OSM enrichment failed for \"" + company.name + "\": " + err.message);
      return company;
    }
  }

  // Only runs if the company has a website (usually found via Places enrichment).
  // Merges scraped decision-makers with NPPES ones, deduped by name. NPPES
  // entries are never overwritten -- scraping only adds names NPPES doesn't have.
  function tryEnrichWithScrape(company) {
    if (!company.website) return company;

    try {
      var result = ScraperService.scrapeCompanyWebsite(company.website);
      if (!result.scraped) return company;

      var existingNames = new Set(company.decisionMakers.map(function (d) { return d.name.toLowerCase(); }));
      var scrapedDMs = result.decisionMakers
        .filter(function (d) { return !existingNames.has(d.name.toLowerCase()); })
        .map(function (d) {
          return {
            name: d.name,
            title: d.title,
            roleCategory: d.roleCategory,
            phone: null,
            source: "website",
            sourceUrl: d.sourceUrl,
          };
        });

      return Object.assign({}, company, {
        email: company.email || result.emails[0] || null,
        decisionMakers: company.decisionMakers.concat(scrapedDMs),
        sources: Object.assign({}, company.sources, { website: true }),
      });
    } catch (err) {
      console.log("[CompanyService] Scrape failed for \"" + company.name + "\": " + err.message);
      return company;
    }
  }

  function getClaimedNpisSafe() {
    try {
      return SheetsStore.getClaimedNpis();
    } catch (err) {
      if (err.name === "SheetsNotConfiguredError") {
        console.log("[CompanyService] Dedup skipped: Google Sheets not configured");
      } else {
        console.log("[CompanyService] Dedup check failed: " + err.message);
      }
      return new Set();
    }
  }

  // Pages through NPPES, filtering out already-claimed NPIs, until we have
  // `desiredLimit` fresh leads or NPPES runs out of results / hits its skip cap.
  function fetchFreshProviders(criteria, desiredLimit, claimedNpis) {
    var fresh = [];
    var skip = 0;
    var totalScanned = 0;

    while (fresh.length < desiredLimit && skip <= NPPES_MAX_SKIP) {
      var result = NppesService.searchProviders(
        Object.assign({}, criteria, { limit: NPPES_PAGE_SIZE, skip: skip })
      );
      var results = result.results;

      // Last-page checks must use rawCount (what NPPES actually returned),
      // not results.length -- local taxonomy/keyword filters can trim a full
      // page and would otherwise end pagination early.
      var fetched = result.rawCount != null ? result.rawCount : results.length;
      if (fetched === 0) break; // NPPES has no more matches at all

      totalScanned += fetched;
      for (var i = 0; i < results.length; i++) {
        if (fresh.length >= desiredLimit) break;
        var provider = results[i];
        // An explicit NPI lookup is a deliberate "pull this exact lead"
        // action -- it should never come back empty just because someone
        // already claimed it, so dedup is skipped in that case only.
        if (criteria.npi || !provider.npi || !claimedNpis.has(String(provider.npi))) {
          fresh.push(provider);
        }
      }

      if (fetched < NPPES_PAGE_SIZE) break; // last page from NPPES
      skip += NPPES_PAGE_SIZE;
    }

    return { fresh: fresh, totalScanned: totalScanned };
  }

  // options: { enrichPlaces = true, scrapeWebsites = false, enrichCms = true }
  function searchCompanies(criteria, options) {
    criteria = criteria || {};
    options = options || {};
    var enrichPlaces = options.enrichPlaces !== false;
    var scrapeWebsites = Boolean(options.scrapeWebsites);
    var enrichCms = options.enrichCms !== false;

    var desiredLimit = criteria.limit || 20;
    var claimedNpis = getClaimedNpisSafe();

    var fetchResult = fetchFreshProviders(criteria, desiredLimit, claimedNpis);
    var providers = fetchResult.fresh;
    var totalScanned = fetchResult.totalScanned;

    var excludedAsClaimed = totalScanned - providers.length;
    var companies = providers.map(fromNppesProvider);

    if (enrichPlaces) {
      companies = applyPlacesEnrichment(companies);
      companies = companies.map(tryEnrichWithOsm);
    }
    if (scrapeWebsites) {
      companies = companies.map(tryEnrichWithScrape);
    }
    if (enrichCms) {
      var medicareByNpi = CmsService.lookupByNpis(companies.map(function (c) { return c.npi; }));
      companies = companies.map(function (company) {
        var medicare = company.npi != null ? medicareByNpi[String(company.npi)] : null;
        if (!medicare) return company;
        return Object.assign({}, company, {
          medicare: medicare,
          sources: Object.assign({}, company.sources, { cms: true }),
        });
      });
    }

    companies = companies.map(function (company) {
      return Object.assign({}, company, { score: ScoringService.scoreCompany(company) });
    });
    companies.sort(function (a, b) { return b.score.value - a.score.value; });

    return {
      count: companies.length,
      scannedFromRegistry: totalScanned,
      excludedAsClaimed: excludedAsClaimed,
      exhaustedRegistry: providers.length < desiredLimit,
      companies: companies,
    };
  }

  return { searchCompanies: searchCompanies };
})();
