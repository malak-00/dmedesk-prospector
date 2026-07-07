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

  // Two independent, exact (never "contains") dedup keys for companies where
  // NPPES's own authorized official is known -- a scraped/website contact
  // isn't reliable enough to key an automatic merge on, so this runs right
  // after fromNppesProvider (before any enrichment adds other decision
  // makers). Either key alone is enough to merge two rows together:
  //  - namePhone: the official's name + phone match exactly -- catches the
  //    same owner/officer operating under a genuinely different registered
  //    company name (a DBA, a renamed entity, etc.).
  //  - companyName: the company name + official's name match exactly -- the
  //    original behavior, for branches sharing a name but with no phone on
  //    file (or a phone that happens to differ per location).
  // A key is null when it can't be computed (missing official/phone/etc.),
  // which callers treat as "this key never merges anything".
  function branchDedupKeys_(company) {
    var official = company.decisionMakers && company.decisionMakers[0];
    if (!official || !official.name) return { namePhone: null, companyName: null };
    var namePart = String(company.name || "").trim().toLowerCase();
    var officialPart = official.name.trim().toLowerCase();
    var phonePart = official.phone ? String(official.phone).trim() : "";

    return {
      namePhone: (officialPart && phonePart) ? (officialPart + "|" + phonePart) : null,
      companyName: (namePart && officialPart) ? (namePart + "|" + officialPart) : null,
    };
  }

  // Chains with a large employer can register a separate NPI per branch
  // location, which otherwise shows up as several near-identical rows for
  // what a rep considers one lead. Folds those into a single row carrying
  // every branch's NPI/address/phone/fax, keeping the first-seen branch's
  // fields (name, taxonomy, etc.) as the row's primary display data. Two
  // rows merge if EITHER branchDedupKeys_() key matches -- this company's
  // own two keys are then both registered against whichever group it joined
  // (or a brand-new group), so a third row matching via the OTHER key still
  // joins the same group. Runs before enrichment so Places/OSM/scrape/CMS
  // calls aren't repeated per branch -- only the primary branch gets enriched.
  function mergeDuplicateBranches_(companies) {
    var keyToIndex = {}; // "np:"/"cn:" prefixed key -> index into `merged`
    var merged = [];

    companies.forEach(function (company) {
      var keys = branchDedupKeys_(company);
      var branch = { npi: company.npi, address: company.address, phone: company.phone, fax: company.fax };

      var namePhoneKey = keys.namePhone ? ("np:" + keys.namePhone) : null;
      var companyNameKey = keys.companyName ? ("cn:" + keys.companyName) : null;

      var matchIndex = null;
      if (namePhoneKey && Object.prototype.hasOwnProperty.call(keyToIndex, namePhoneKey)) {
        matchIndex = keyToIndex[namePhoneKey];
      } else if (companyNameKey && Object.prototype.hasOwnProperty.call(keyToIndex, companyNameKey)) {
        matchIndex = keyToIndex[companyNameKey];
      }

      if (matchIndex != null) {
        merged[matchIndex].locations.push(branch);
      } else {
        matchIndex = merged.length;
        merged.push(Object.assign({}, company, { locations: [branch] }));
      }

      if (namePhoneKey) keyToIndex[namePhoneKey] = matchIndex;
      if (companyNameKey) keyToIndex[companyNameKey] = matchIndex;
    });

    return merged;
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

  // NPPES only accepts ONE state and ONE taxonomy_description per request --
  // there's no server-side "OR" across values. Multi-select on either field
  // is implemented by running one query variant per combination (cartesian
  // product) and merging the results, rather than by widening a single
  // query and filtering locally: sending only one taxonomy to NPPES would
  // have it pre-filter out every OTHER selected taxonomy's real matches
  // before they ever reach this app.
  //
  // A single-value legacy criteria.state/taxonomyDescription (no
  // states/taxonomyDescriptions array) still produces exactly one variant,
  // so this is a no-op for every search that isn't using multi-select.
  function buildCriteriaVariants_(criteria) {
    var states = (criteria.states && criteria.states.length) ? criteria.states : [criteria.state || undefined];
    var taxonomies = (criteria.taxonomyDescriptions && criteria.taxonomyDescriptions.length)
      ? criteria.taxonomyDescriptions
      : [criteria.taxonomyDescription || undefined];

    var variants = [];
    states.forEach(function (state) {
      taxonomies.forEach(function (taxonomyDescription) {
        variants.push(Object.assign({}, criteria, { state: state, taxonomyDescription: taxonomyDescription }));
      });
    });
    return variants;
  }

  // A stable key identifying one query variant, used to remember (across
  // separate "Search more" requests) exactly which NPPES skip depth this
  // variant last stopped at.
  function variantKey_(variant) {
    return (variant.state || "") + "|" + (variant.taxonomyDescription || "");
  }

  // Pages through NPPES (across every state x taxonomy variant, in the
  // multi-select case), filtering out already-claimed NPIs, until we have
  // `desiredLimit` fresh leads or every variant runs out of results / hits
  // its skip cap.
  //
  // `criteria.variantSkips` (an opaque map from variantKey_() -> skip)
  // resumes each variant from wherever a previous call for this exact
  // search left off, instead of always starting at 0 -- this is what backs
  // the frontend's "Search more" button (rerun the identical filters and see
  // leads beyond what's already been shown, rather than the same top
  // results every time). Returned back to the caller so it can be replayed
  // on the next "Search more" click. `criteria.excludeNpis` similarly skips
  // any NPI already shown earlier in this search session, so a company
  // reachable through more than one variant can't reappear either.
  function fetchFreshProviders(criteria, desiredLimit, claimedNpis) {
    // An explicit NPI lookup ignores state/taxonomy entirely (see
    // NppesService.searchProviders), so multiple variants would just repeat
    // the identical lookup -- always exactly one variant in that case.
    var variants = criteria.npi ? [criteria] : buildCriteriaVariants_(criteria);

    var fresh = [];
    var totalScanned = 0;
    // Counts ONLY providers actually skipped for being claimed -- deliberately
    // NOT "totalScanned - fresh.length", which used to also fold in providers
    // that never matched a local nameContains/taxonomy/year filter (rawCount
    // is pre-filter) and ones simply never looked at because desiredLimit was
    // already hit mid-page. That made "already claimed" wildly overcount
    // whenever a search had a narrow filter, even with zero actual claims.
    var excludedAsClaimed = 0;
    // Dedupes across variants -- e.g. a company whose registered taxonomy
    // happens to match two different selected specialties would otherwise
    // be fetched (and counted) once per matching variant. Seeded with
    // whatever's already been shown in an earlier "Search more" click for
    // this exact search, so continuing doesn't repeat those either.
    var seenNpis = {};
    (criteria.excludeNpis || []).forEach(function (npi) { seenNpis[String(npi)] = true; });

    var variantSkips = Object.assign({}, criteria.variantSkips || {});

    for (var v = 0; v < variants.length && fresh.length < desiredLimit; v++) {
      var variant = variants[v];
      var key = variantKey_(variant);
      var skip = variantSkips[key] || 0;

      while (fresh.length < desiredLimit && skip <= NPPES_MAX_SKIP) {
        var result = NppesService.searchProviders(
          Object.assign({}, variant, { limit: NPPES_PAGE_SIZE, skip: skip })
        );
        var results = result.results;

        // Last-page checks must use rawCount (what NPPES actually returned),
        // not results.length -- local taxonomy/keyword filters can trim a full
        // page and would otherwise end pagination early.
        var fetched = result.rawCount != null ? result.rawCount : results.length;
        if (fetched === 0) break; // NPPES has no more matches for this variant

        totalScanned += fetched;
        for (var i = 0; i < results.length; i++) {
          if (fresh.length >= desiredLimit) break;
          var provider = results[i];
          if (provider.npi && Object.prototype.hasOwnProperty.call(seenNpis, String(provider.npi))) continue;

          // An explicit NPI lookup is a deliberate "pull this exact lead"
          // action -- it should never come back empty just because someone
          // already claimed it, so dedup is skipped in that case only.
          var isClaimed = !criteria.npi && provider.npi && claimedNpis.has(String(provider.npi));
          if (isClaimed) {
            excludedAsClaimed++;
          } else {
            fresh.push(provider);
          }
          if (provider.npi) seenNpis[String(provider.npi)] = true;
        }

        if (fetched < NPPES_PAGE_SIZE) break; // last page from NPPES for this variant
        skip += NPPES_PAGE_SIZE;
      }

      variantSkips[key] = skip; // remember exactly where this variant stopped for next time
    }

    return { fresh: fresh, totalScanned: totalScanned, excludedAsClaimed: excludedAsClaimed, variantSkips: variantSkips };
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
    var excludedAsClaimed = fetchResult.excludedAsClaimed;
    var companies = providers.map(fromNppesProvider);
    // An explicit NPI lookup already identifies one exact record -- merging
    // would be a no-op at best and confusing at worst, so it's skipped there.
    if (!criteria.npi) companies = mergeDuplicateBranches_(companies);

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
      variantSkips: fetchResult.variantSkips,
      companies: companies,
    };
  }

  return { searchCompanies: searchCompanies };
})();
