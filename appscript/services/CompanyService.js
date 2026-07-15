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
  // Hard cap on how many NPPES page-fetches ONE request is allowed to make,
  // across every state x taxonomy variant combined. Without this, a broad
  // multi-specialty search (several variants) combined with deep "Search
  // more" pagination (each variant's remembered skip already pushed far in
  // by earlier clicks) can add up to dozens of sequential NPPES calls in a
  // single execution -- slow enough that Apps Script's response-delivery
  // layer can fail outright (a raw "Failed to fetch"/CORS error to the
  // browser) instead of the app ever getting a chance to return a clean
  // result. Hitting this budget just means "found what we could this round,
  // there may be more" -- NOT "genuinely out of results" -- see
  // fetchFreshProviders' hitScanBudget tracking below.
  var MAX_NPPES_FETCHES_PER_REQUEST = 30;

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
  // every branch's NPI/address/phone, keeping the first-seen branch's
  // fields (name, taxonomy, etc.) as the row's primary display data. Two
  // rows merge if EITHER branchDedupKeys_() key matches -- this company's
  // own two keys are then both registered against whichever group it joined
  // (or a brand-new group), so a third row matching via the OTHER key still
  // joins the same group. Runs before enrichment so Places/OSM/scrape/CMS
  // calls aren't repeated per branch -- only the primary branch gets enriched.
  //
  // Built as an incremental accumulator (not a one-shot array->array
  // function) so fetchFreshProviders below can feed it companies one at a
  // time AS they're fetched and check its post-merge distinct count against
  // desiredLimit -- otherwise "search for 50" can fetch exactly 50 raw NPIs
  // that merge down to fewer distinct companies (several branches of the
  // same chain collapsing into one row), silently returning fewer leads
  // than asked for even though the registry had plenty more to fetch.
  function createBranchMerger_() {
    var keyToIndex = {}; // "np:"/"cn:" prefixed key -> index into `merged`
    var merged = [];

    function add(company) {
      var keys = branchDedupKeys_(company);
      var branch = { npi: company.npi, address: company.address, phone: company.phone };

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
    }

    return {
      add: add,
      list: function () { return merged; },
      get length() { return merged.length; },
    };
  }

  // Kept as the array-in/array-out entry point for anywhere that already has
  // a full company list up front (not building one up incrementally).
  function mergeDuplicateBranches_(companies) {
    var merger = createBranchMerger_();
    companies.forEach(merger.add);
    return merger.list();
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

  // Guards against SearchProgressService being unavailable (older test
  // harnesses that eval only CompanyService.js/NppesService.js won't define
  // the global at all) as well as any runtime failure -- a resume/persist
  // hiccup should never take down an otherwise-working search.
  function getSearchProgressSafe_(username, criteria) {
    if (typeof SearchProgressService === "undefined") return null;
    try {
      return SearchProgressService.getProgress(username, criteria);
    } catch (err) {
      console.log("[CompanyService] SearchProgress resume failed: " + err.message);
      return null;
    }
  }

  function saveSearchProgressSafe_(username, criteria, variantSkips, seenNpis) {
    if (typeof SearchProgressService === "undefined") return;
    try {
      SearchProgressService.saveProgress(username, criteria, variantSkips, seenNpis);
    } catch (err) {
      console.log("[CompanyService] SearchProgress save failed: " + err.message);
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

  // Pages through NPPES (round-robin across every state x taxonomy variant,
  // in the multi-select case -- one page from each variant per round, not
  // fully draining variant 0 before ever touching variant 1, so a search
  // across several states/specialties surfaces leads from ALL of them
  // instead of letting whichever variant is listed first silently satisfy
  // the whole desiredLimit), filtering out already-claimed NPIs, until we
  // have `desiredLimit` distinct COMPANIES (after branch-merging -- see
  // createBranchMerger_ above) or every variant runs out of results / hits
  // its skip cap.
  //
  // The stopping condition is deliberately the post-merge count, not the raw
  // fetched-provider count: several branches of the same chain can collapse
  // into a single merged row, so stopping as soon as `desiredLimit` raw
  // providers were fetched can hand back fewer distinct companies than asked
  // for (e.g. "search for 50" landing on 44). Merging incrementally, as each
  // provider is accepted, means the loop can tell the difference and keep
  // fetching until it actually has `desiredLimit` rows to show. An explicit
  // NPI lookup never merges (see createBranchMerger_'s caller in
  // searchCompanies) -- that's a single exact record, not a broad scan.
  //
  // `criteria.variantSkips` (an opaque map from variantKey_() -> skip)
  // resumes each variant from wherever a previous call for this exact
  // search left off, instead of always starting at 0 -- this is what backs
  // the frontend's "Search more" button (rerun the identical filters and see
  // leads beyond what's already been shown, rather than the same top
  // results every time), and (see searchCompanies) what a resumed
  // SearchProgress bookmark seeds a brand-new "Search" with too. Returned
  // back to the caller so it can be persisted/replayed. `criteria.excludeNpis`
  // similarly skips any NPI already shown earlier, so a company reachable
  // through more than one variant can't reappear either.
  function fetchFreshProviders(criteria, desiredLimit, claimedNpis) {
    // An explicit NPI lookup ignores state/taxonomy entirely (see
    // NppesService.searchProviders), so multiple variants would just repeat
    // the identical lookup -- always exactly one variant in that case.
    var variants = criteria.npi ? [criteria] : buildCriteriaVariants_(criteria);
    var mergeBranches = !criteria.npi;
    var merger = createBranchMerger_();

    var fresh = []; // raw accepted providers, in fetch order -- exact-NPI path returns these 1:1 mapped, no merge
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
    // whatever's already been shown earlier (an in-session "Search more"
    // click, or a resumed SearchProgress bookmark), so continuing doesn't
    // repeat those either.
    var seenNpis = {};
    (criteria.excludeNpis || []).forEach(function (npi) { seenNpis[String(npi)] = true; });

    var variantSkips = Object.assign({}, criteria.variantSkips || {});
    var fetchesUsed = 0;
    var hitScanBudget = false;
    // NPPES rejects some taxonomy_description values outright -- a real
    // "Errors" rejection (see NppesService's fetchFromNppes), not just zero
    // matches -- when the text isn't one of its own exact registered
    // taxonomy strings. That's a real risk for Description values pasted
    // into the Taxonomies sheet from an outside crosswalk document, and
    // multi-select runs one variant per selected taxonomy (see
    // buildCriteriaVariants_ above), so a single bad one used to throw
    // unhandled and abort the ENTIRE search -- even taxonomies selected
    // alongside it that NPPES would have happily accepted. Collected here
    // instead so the caller can report exactly which selection(s) failed
    // while the rest of the search still runs.
    var rejectedVariants = [];

    function acceptedCount() { return mergeBranches ? merger.length : fresh.length; }

    // Tracks which variants have nothing left worth fetching -- either NPPES
    // itself just ran out (an empty or short/last page) or this variant's
    // skip has already reached NPPES_MAX_SKIP -- so later rounds stop
    // bothering to re-query a fully-drained state/specialty.
    var variantExhausted = variants.map(function (variant) {
      return (variantSkips[variantKey_(variant)] || 0) > NPPES_MAX_SKIP;
    });

    function anyVariantLeft() {
      return variantExhausted.some(function (done) { return !done; });
    }

    // Round-robin across every variant -- one page from variant 0, then one
    // page from variant 1, ... back to variant 0 -- instead of fully
    // draining one variant before ever touching the next. Selecting several
    // states/specialties should surface leads from ALL of them, not just
    // whichever variant happens to be listed first: with a "finish variant 0
    // first" order, a state with an abundant supply of fresh matches could
    // single-handedly satisfy desiredLimit before a SECOND selected state
    // was ever queried at all -- effectively hiding it from every result,
    // and getting worse the more states/specialties were selected.
    while (acceptedCount() < desiredLimit && !hitScanBudget && anyVariantLeft()) {
      // Recomputed every round from what's still needed and how many
      // variants are still in play -- a fair-share cap on how much of THIS
      // round's page each variant is allowed to contribute, so one variant
      // with a huge page of matches can't single-handedly fill desiredLimit
      // before its round-robin turn even reaches the next variant. Shrinks
      // to "no cap" once only one variant is left un-exhausted, so the tail
      // end of a search doesn't waste fetches trickling in a few at a time
      // when there's nothing left to interleave with anyway.
      var remainingVariants = variantExhausted.filter(function (done) { return !done; }).length;
      var roundQuota = Math.max(1, Math.ceil((desiredLimit - acceptedCount()) / remainingVariants));

      for (var v = 0; v < variants.length; v++) {
        if (variantExhausted[v]) continue;
        if (acceptedCount() >= desiredLimit) break;
        if (fetchesUsed >= MAX_NPPES_FETCHES_PER_REQUEST) {
          hitScanBudget = true; // stop paging -- budget spent, not necessarily out of real results
          break;
        }

        var variant = variants[v];
        var key = variantKey_(variant);
        var skip = variantSkips[key] || 0;
        fetchesUsed++;

        var result;
        try {
          result = NppesService.searchProviders(
            Object.assign({}, variant, { limit: NPPES_PAGE_SIZE, skip: skip })
          );
        } catch (err) {
          // Isolate the failure to just this one state/taxonomy combination
          // -- mark it exhausted so the loop never retries it, record why,
          // and keep going with whatever other variants are still in play.
          console.log("[CompanyService] NPPES query variant failed, skipping it: " + key + " -- " + err.message);
          rejectedVariants.push({
            state: variant.state || null,
            taxonomyDescription: variant.taxonomyDescription || null,
            message: err.message,
          });
          variantExhausted[v] = true;
          continue;
        }
        var results = result.results;

        // Last-page checks must use rawCount (what NPPES actually returned),
        // not results.length -- local taxonomy/keyword filters can trim a full
        // page and would otherwise end pagination early.
        var fetched = result.rawCount != null ? result.rawCount : results.length;

        if (fetched === 0) {
          variantExhausted[v] = true; // NPPES has no more matches for this variant
        } else {
          totalScanned += fetched;
          var acceptedBeforeThisTurn = acceptedCount();
          for (var i = 0; i < results.length; i++) {
            if (acceptedCount() >= desiredLimit) break;
            if (acceptedCount() - acceptedBeforeThisTurn >= roundQuota) break; // this variant's fair share for this round is used up
            var provider = results[i];
            if (provider.npi && Object.prototype.hasOwnProperty.call(seenNpis, String(provider.npi))) continue;

            // Claimed-lead exclusion applies uniformly across every search
            // type, including an exact NPI lookup -- a claimed lead has
            // already been pulled into someone's pipeline, so Prospect (the
            // "not yet claimed" view) should never surface it again just
            // because it was looked up by its exact NPI instead of by name/
            // city/specialty. excludedAsClaimed still increments here, so a
            // claimed NPI's lookup correctly reports "0 leads found (1
            // already claimed, filtered out)" instead of a bare, unexplained
            // "0 leads found".
            var isClaimed = provider.npi && claimedNpis.has(String(provider.npi));
            if (isClaimed) {
              excludedAsClaimed++;
            } else {
              fresh.push(provider);
              if (mergeBranches) merger.add(fromNppesProvider(provider));
            }
            if (provider.npi) seenNpis[String(provider.npi)] = true;
          }

          if (fetched < NPPES_PAGE_SIZE) variantExhausted[v] = true; // last page from NPPES for this variant
          skip += NPPES_PAGE_SIZE;
        }

        variantSkips[key] = skip; // remember exactly where this variant stopped for next time
        if (skip > NPPES_MAX_SKIP) variantExhausted[v] = true;
      }
    }

    return {
      companies: mergeBranches ? merger.list() : fresh.map(fromNppesProvider),
      totalScanned: totalScanned,
      excludedAsClaimed: excludedAsClaimed,
      variantSkips: variantSkips,
      hitScanBudget: hitScanBudget,
      allSeenNpis: Object.keys(seenNpis),
      rejectedVariants: rejectedVariants,
    };
  }

  // options: { enrichPlaces = true, scrapeWebsites = false, enrichCms = true,
  //            username, clientProvidedVariantSkips }
  //
  // `username` + `clientProvidedVariantSkips` back the SearchProgress
  // auto-resume: a brand-new "Search" (frontend sends no variantSkips of its
  // own -- clientProvidedVariantSkips is false) for a filter set this user
  // has searched before picks up from their last remembered position instead
  // of always restarting at the top of the registry. An explicit "Search
  // more" click already carries its own variantSkips/excludeNpis from the
  // current browsing session (clientProvidedVariantSkips is true) and takes
  // priority -- the bookmark is only ever a fallback for when the client
  // didn't already say exactly where to resume. Either way, the bookmark is
  // updated afterward so a FUTURE plain "Search" continues from wherever
  // this request (fresh or "more") left off. Skipped entirely for an exact
  // NPI lookup (criteria.npi) -- that always identifies the same single
  // record, so there's nothing to resume.
  function searchCompanies(criteria, options) {
    criteria = criteria || {};
    options = options || {};
    var enrichPlaces = options.enrichPlaces !== false;
    var scrapeWebsites = Boolean(options.scrapeWebsites);
    var enrichCms = options.enrichCms !== false;

    var desiredLimit = criteria.limit || 20;
    var claimedNpis = getClaimedNpisSafe();

    var trackProgress = Boolean(options.username) && !criteria.npi;
    var effectiveCriteria = criteria;
    if (trackProgress && !options.clientProvidedVariantSkips) {
      var progress = getSearchProgressSafe_(options.username, criteria);
      if (progress) {
        effectiveCriteria = Object.assign({}, criteria, {
          variantSkips: progress.variantSkips,
          excludeNpis: (criteria.excludeNpis || []).concat(progress.seenNpis),
        });
      }
    }

    var fetchResult = fetchFreshProviders(effectiveCriteria, desiredLimit, claimedNpis);
    var totalScanned = fetchResult.totalScanned;
    var excludedAsClaimed = fetchResult.excludedAsClaimed;
    // Already merged (or, for an exact NPI lookup, mapped 1:1) INSIDE the
    // fetch loop -- see fetchFreshProviders -- so `companies.length` here is
    // the real, final count the loop was actually targeting against
    // desiredLimit, not a pre-merge count that can shrink further below.
    var companies = fetchResult.companies;

    if (trackProgress) {
      saveSearchProgressSafe_(options.username, criteria, fetchResult.variantSkips, fetchResult.allSeenNpis);
    }

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
      // Finding fewer than desired normally means the registry is genuinely
      // exhausted -- EXCEPT when the scan budget cut things short first, in
      // which case there may well be more, we just didn't get to look this
      // round (the frontend leaves "Search more" clickable in that case, so
      // the next click picks up right where this one's variantSkips stopped).
      exhaustedRegistry: companies.length < desiredLimit && !fetchResult.hitScanBudget,
      variantSkips: fetchResult.variantSkips,
      // Non-empty only when NPPES flat-out rejected one or more selected
      // state/taxonomy combinations (see fetchFreshProviders above) -- the
      // rest of the search still ran normally, this is just so the caller
      // can tell the rep exactly which selection(s) to fix/remove instead of
      // silently returning fewer leads than expected with no explanation.
      rejectedVariants: fetchResult.rejectedVariants,
      companies: companies,
    };
  }

  return { searchCompanies: searchCompanies };
})();
