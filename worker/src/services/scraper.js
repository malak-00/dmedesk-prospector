// Port of appscript/services/ScraperService.js. Uses the same regex/
// newline-based "block boundary" heuristic as the Apps Script version
// (still no real DOM/cheerio here either -- Workers doesn't ship one by
// default and pulling in a full HTML parser wasn't worth it for a
// best-effort supplement to NPPES data). The one real upgrade: relative-URL
// resolution uses the platform's native `URL` class instead of the
// hand-rolled UrlUtils.js Apps Script needed.
import { classifyRole, ROLE_CATEGORIES } from "../lib/roleClassifier.js";

const USER_AGENT = "DMEDeskProspectorBot/1.0 (+prospecting research)";
const MAX_PAGES = 4;
const RELEVANT_PAGE_KEYWORDS = [
  { keyword: "team", type: "team" },
  { keyword: "staff", type: "team" },
  { keyword: "leadership", type: "team" },
  { keyword: "about", type: "about" },
  { keyword: "contact", type: "contact" },
];

async function checkRobotsAllowed(baseUrl, path) {
  try {
    const robotsUrl = new URL("/robots.txt", baseUrl).toString();
    const res = await fetch(robotsUrl, { headers: { "User-Agent": USER_AGENT } });
    if (res.status >= 400) return true;

    const lines = (await res.text()).split("\n").map((l) => l.trim());
    let applicable = false;
    const disallowed = [];
    lines.forEach((line) => {
      if (/^user-agent:\s*\*/i.test(line)) applicable = true;
      else if (/^user-agent:/i.test(line)) applicable = false;
      else if (applicable && /^disallow:/i.test(line)) {
        const rule = (line.split(":")[1] || "").trim();
        if (rule) disallowed.push(rule);
      }
    });
    return !disallowed.some((rule) => rule !== "" && path.indexOf(rule) === 0);
  } catch {
    return true;
  }
}

async function fetchPage(url) {
  try {
    const response = await fetch(url, { redirect: "follow", headers: { "User-Agent": USER_AGENT, Accept: "text/html" } });
    if (response.status >= 400) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function extractEmails(html) {
  const matches = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  const cleaned = matches.map((e) => e.toLowerCase()).filter((e) => !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(e));
  return Array.from(new Set(cleaned));
}

function extractPhones(html) {
  const matches = html.match(/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || [];
  return Array.from(new Set(matches.map((p) => p.trim())));
}

function stripTags(html) {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h[1-4]|\/span)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

function findRelevantLinks(html, baseUrl) {
  const found = new Map();
  const baseOrigin = new URL(baseUrl).origin;
  const anchorRegex = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1];
    const text = stripTags(match[2]).toLowerCase();
    if (!href || href.indexOf("mailto:") === 0 || href.indexOf("tel:") === 0) continue;

    let absolute;
    try {
      absolute = new URL(href, baseUrl).toString();
      if (new URL(absolute).origin !== baseOrigin) continue;
    } catch {
      continue;
    }

    for (const { keyword, type } of RELEVANT_PAGE_KEYWORDS) {
      if (href.toLowerCase().indexOf(keyword) !== -1 || text.indexOf(keyword) !== -1) {
        if (!found.has(absolute)) found.set(absolute, type);
      }
    }
  }

  return found;
}

function extractStaffFromPage(html, sourceUrl) {
  const people = [];
  const allKeywords = [];
  for (const cat of Object.keys(ROLE_CATEGORIES)) {
    ROLE_CATEGORIES[cat].forEach((k) => allKeywords.push(k.trim()));
  }
  const keywordRegex = new RegExp("\\b(" + allKeywords.join("|") + ")\\b", "i");

  const lines = stripTags(html)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (!text || text.length > 120) continue;
    if (!keywordRegex.test(text)) continue;

    const inlineMatch = text.match(/^([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){1,3})\s*[,\-–|]\s*(.+)$/);
    if (inlineMatch) {
      people.push({ name: inlineMatch[1].trim(), title: inlineMatch[2].trim(), sourceUrl });
      continue;
    }

    const prevText = i > 0 ? lines[i - 1] : "";
    if (prevText && prevText.length < 60 && /^([A-Z][a-zA-Z.'-]+\s+){1,3}[A-Z][a-zA-Z.'-]+$/.test(prevText)) {
      people.push({ name: prevText, title: text, sourceUrl });
    }
  }

  const seen = new Set();
  return people.filter((p) => {
    const key = p.name.toLowerCase() + "|" + p.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function scrapeCompanyWebsite(url) {
  if (!url) {
    const missing = new Error("A website URL is required");
    missing.status = 400;
    throw missing;
  }

  let baseUrl;
  try {
    baseUrl = new URL(url).toString();
  } catch {
    const invalid = new Error("Invalid URL");
    invalid.status = 400;
    throw invalid;
  }

  const allowed = await checkRobotsAllowed(baseUrl, new URL(baseUrl).pathname);
  if (!allowed) {
    return { url: baseUrl, scraped: false, reason: "Disallowed by robots.txt", emails: [], phones: [], decisionMakers: [] };
  }

  const homepageHtml = await fetchPage(baseUrl);
  if (!homepageHtml) {
    return { url: baseUrl, scraped: false, reason: "Could not fetch homepage", emails: [], phones: [], decisionMakers: [] };
  }

  const relevantLinks = findRelevantLinks(homepageHtml, baseUrl);
  const pagesToFetch = [baseUrl, ...Array.from(relevantLinks.keys())].slice(0, MAX_PAGES);

  const emails = new Set(extractEmails(homepageHtml));
  const phones = new Set(extractPhones(homepageHtml));
  let staff = extractStaffFromPage(homepageHtml, baseUrl);

  for (let i = 1; i < pagesToFetch.length; i++) {
    const html = await fetchPage(pagesToFetch[i]);
    if (!html) continue;
    extractEmails(html).forEach((e) => emails.add(e));
    extractPhones(html).forEach((p) => phones.add(p));
    staff = staff.concat(extractStaffFromPage(html, pagesToFetch[i]));
  }

  const priority = { owner: 0, executive: 1, manager: 2, admin: 3, staff: 4 };
  const decisionMakers = staff
    .map((person) => Object.assign({}, person, { roleCategory: classifyRole(person.title) }))
    .filter((p) => p.roleCategory !== "unknown")
    .sort((a, b) => priority[a.roleCategory] - priority[b.roleCategory]);

  return {
    url: baseUrl,
    scraped: true,
    pagesChecked: pagesToFetch.length,
    emails: Array.from(emails),
    phones: Array.from(phones),
    decisionMakers,
  };
}
