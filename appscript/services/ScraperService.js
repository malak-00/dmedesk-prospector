// Port of backend/src/services/scraper.service.js.
//
// IMPORTANT DIFFERENCE FROM THE NODE VERSION: Apps Script has no npm/cheerio,
// so there's no real HTML DOM to query. Link discovery and staff/title
// extraction here are done with regex and newline-based "block boundary"
// approximation instead of actual DOM traversal. This is meaningfully less
// accurate than the Node version on messy real-world HTML -- treat it as a
// best-effort supplement to NPPES data, same as the original was designed to
// be, just with a lower hit rate. Email/phone extraction is unaffected since
// the Node version already regexed those directly off raw HTML, not the DOM.
//
// Also note: this fixes a latent bug in the Node version, where
// extractStaffFromPage() referenced ROLE_CATEGORIES without importing it
// (only classifyRole was imported), so it threw a ReferenceError whenever
// scraping ran and was silently swallowed by the caller's try/catch --
// meaning scraped decision-makers never actually made it through in
// production. Worth fixing in backend/ too.

var ScraperService = (function () {
  var USER_AGENT = "DMEDeskProspectorBot/1.0 (+prospecting research)";
  var MAX_PAGES = 4; // homepage + up to 3 relevant subpages
  var RELEVANT_PAGE_KEYWORDS = [
    { keyword: "team", type: "team" },
    { keyword: "staff", type: "team" },
    { keyword: "leadership", type: "team" },
    { keyword: "about", type: "about" },
    { keyword: "contact", type: "contact" },
  ];

  function checkRobotsAllowed(baseUrl, path) {
    try {
      var robotsUrl = UrlUtils.resolve("/robots.txt", baseUrl);
      var res = UrlFetchApp.fetch(robotsUrl, {
        muteHttpExceptions: true,
        headers: { "User-Agent": USER_AGENT },
      });
      if (res.getResponseCode() >= 400) return true;

      var lines = res.getContentText().split("\n").map(function (l) { return l.trim(); });
      var applicable = false;
      var disallowed = [];
      lines.forEach(function (line) {
        if (/^user-agent:\s*\*/i.test(line)) applicable = true;
        else if (/^user-agent:/i.test(line)) applicable = false;
        else if (applicable && /^disallow:/i.test(line)) {
          var rule = (line.split(":")[1] || "").trim();
          if (rule) disallowed.push(rule);
        }
      });
      return !disallowed.some(function (rule) { return rule !== "" && path.indexOf(rule) === 0; });
    } catch (err) {
      return true; // no robots.txt or unreachable -> assume allowed
    }
  }

  function fetchPage(url) {
    try {
      var response = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      });
      var code = response.getResponseCode();
      if (code >= 400) return null;
      return response.getContentText();
    } catch (err) {
      return null;
    }
  }

  function extractEmails(html) {
    var matches = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    var cleaned = matches
      .map(function (e) { return e.toLowerCase(); })
      .filter(function (e) { return !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(e); });
    return Array.from(new Set(cleaned));
  }

  function extractPhones(html) {
    var matches = html.match(/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || [];
    return Array.from(new Set(matches.map(function (p) { return p.trim(); })));
  }

  function stripTags(html) {
    // Turn block-level boundaries into newlines before stripping tags, as a
    // stand-in for "each DOM element is its own line" since there's no real DOM.
    return html
      .replace(/<(br|\/p|\/div|\/li|\/h[1-4]|\/span)\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&");
  }

  function findRelevantLinks(html, baseUrl) {
    var found = new Map();
    var baseOrigin = UrlUtils.getOrigin(baseUrl);
    var anchorRegex = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    var match;

    while ((match = anchorRegex.exec(html)) !== null) {
      var href = match[1];
      var text = stripTags(match[2]).toLowerCase();
      if (!href || href.indexOf("mailto:") === 0 || href.indexOf("tel:") === 0) continue;

      var absolute;
      try {
        absolute = UrlUtils.resolve(href, baseUrl);
        if (UrlUtils.getOrigin(absolute) !== baseOrigin) continue;
      } catch (err) {
        continue;
      }

      for (var i = 0; i < RELEVANT_PAGE_KEYWORDS.length; i++) {
        var keyword = RELEVANT_PAGE_KEYWORDS[i].keyword;
        if (href.toLowerCase().indexOf(keyword) !== -1 || text.indexOf(keyword) !== -1) {
          if (!found.has(absolute)) found.set(absolute, RELEVANT_PAGE_KEYWORDS[i].type);
        }
      }
    }

    return found;
  }

  // Heuristic staff extraction: splits stripped text into "lines" (our
  // approximation of DOM elements), finds short lines containing a role
  // keyword, then checks the same line ("Name, Title") or the previous
  // line for a name-shaped string.
  function extractStaffFromPage(html, sourceUrl) {
    var people = [];
    var allKeywords = [];
    var categories = RoleClassifier.ROLE_CATEGORIES;
    for (var cat in categories) {
      categories[cat].forEach(function (k) { allKeywords.push(k.trim()); });
    }
    var keywordRegex = new RegExp("\\b(" + allKeywords.join("|") + ")\\b", "i");

    var lines = stripTags(html)
      .split("\n")
      .map(function (l) { return l.replace(/\s+/g, " ").trim(); })
      .filter(Boolean);

    for (var i = 0; i < lines.length; i++) {
      var text = lines[i];
      if (!text || text.length > 120) continue;
      if (!keywordRegex.test(text)) continue;

      var inlineMatch = text.match(
        /^([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){1,3})\s*[,\-–|]\s*(.+)$/
      );
      if (inlineMatch) {
        people.push({ name: inlineMatch[1].trim(), title: inlineMatch[2].trim(), sourceUrl: sourceUrl });
        continue;
      }

      var prevText = i > 0 ? lines[i - 1] : "";
      if (
        prevText &&
        prevText.length < 60 &&
        /^([A-Z][a-zA-Z.'-]+\s+){1,3}[A-Z][a-zA-Z.'-]+$/.test(prevText)
      ) {
        people.push({ name: prevText, title: text, sourceUrl: sourceUrl });
      }
    }

    var seen = new Set();
    return people.filter(function (p) {
      var key = p.name.toLowerCase() + "|" + p.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Full pipeline: fetch homepage, discover About/Contact/Team pages,
  // fetch those (respecting robots.txt), aggregate contacts + staff.
  function scrapeCompanyWebsite(url) {
    if (!url) {
      var missing = new Error("A website URL is required");
      missing.status = 400;
      throw missing;
    }

    var baseUrl;
    try {
      baseUrl = UrlUtils.normalize(url);
    } catch (err) {
      var invalid = new Error("Invalid URL");
      invalid.status = 400;
      throw invalid;
    }

    var allowed = checkRobotsAllowed(baseUrl, UrlUtils.getPathname(baseUrl));
    if (!allowed) {
      return { url: baseUrl, scraped: false, reason: "Disallowed by robots.txt", emails: [], phones: [], decisionMakers: [] };
    }

    var homepageHtml = fetchPage(baseUrl);
    if (!homepageHtml) {
      return { url: baseUrl, scraped: false, reason: "Could not fetch homepage", emails: [], phones: [], decisionMakers: [] };
    }

    var relevantLinks = findRelevantLinks(homepageHtml, baseUrl);
    var pagesToFetch = [baseUrl].concat(Array.from(relevantLinks.keys())).slice(0, MAX_PAGES);

    var emails = new Set(extractEmails(homepageHtml));
    var phones = new Set(extractPhones(homepageHtml));
    var staff = extractStaffFromPage(homepageHtml, baseUrl);

    for (var i = 1; i < pagesToFetch.length; i++) {
      var html = fetchPage(pagesToFetch[i]);
      if (!html) continue;
      extractEmails(html).forEach(function (e) { emails.add(e); });
      extractPhones(html).forEach(function (p) { phones.add(p); });
      staff = staff.concat(extractStaffFromPage(html, pagesToFetch[i]));
    }

    var priority = { owner: 0, executive: 1, manager: 2, admin: 3, staff: 4 };
    var decisionMakers = staff
      .map(function (person) {
        return Object.assign({}, person, { roleCategory: RoleClassifier.classifyRole(person.title) });
      })
      .filter(function (p) { return p.roleCategory !== "unknown"; })
      .sort(function (a, b) { return priority[a.roleCategory] - priority[b.roleCategory]; });

    return {
      url: baseUrl,
      scraped: true,
      pagesChecked: pagesToFetch.length,
      emails: Array.from(emails),
      phones: Array.from(phones),
      decisionMakers: decisionMakers,
    };
  }

  return { scrapeCompanyWebsite: scrapeCompanyWebsite };
})();
