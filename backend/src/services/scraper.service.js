import axios from "axios";
import * as cheerio from "cheerio";
import { classifyRole, ROLE_CATEGORIES } from "../utils/roleClassifier.js";

const USER_AGENT = "DMEDeskProspectorBot/1.0 (+prospecting research)";
const MAX_PAGES = 4; // homepage + up to 3 relevant subpages
const REQUEST_TIMEOUT = 8000;

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
    const res = await axios.get(robotsUrl, {
      timeout: 5000,
      headers: { "User-Agent": USER_AGENT },
    });
    const lines = String(res.data).split("\n").map((l) => l.trim());
    let applicable = false;
    const disallowed = [];
    for (const line of lines) {
      if (/^user-agent:\s*\*/i.test(line)) applicable = true;
      else if (/^user-agent:/i.test(line)) applicable = false;
      else if (applicable && /^disallow:/i.test(line)) {
        const rule = line.split(":")[1]?.trim();
        if (rule) disallowed.push(rule);
      }
    }
    return !disallowed.some((rule) => rule !== "" && path.startsWith(rule));
  } catch {
    return true; // no robots.txt or unreachable -> assume allowed
  }
}

async function fetchPage(url) {
  try {
    const response = await axios.get(url, {
      timeout: REQUEST_TIMEOUT,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      maxRedirects: 3,
      validateStatus: (status) => status < 500,
    });
    if (response.status >= 400 || typeof response.data !== "string") return null;
    return response.data;
  } catch {
    return null;
  }
}

function extractEmails(html) {
  const matches = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  const cleaned = matches
    .map((e) => e.toLowerCase())
    .filter((e) => !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(e));
  return [...new Set(cleaned)];
}

function extractPhones(html) {
  const matches = html.match(/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || [];
  return [...new Set(matches.map((p) => p.trim()))];
}

function findRelevantLinks($, baseUrl) {
  const found = new Map();
  const baseOrigin = new URL(baseUrl).origin;

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().toLowerCase();
    if (!href) return;

    let absolute;
    try {
      absolute = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    if (new URL(absolute).origin !== baseOrigin) return;

    for (const { keyword, type } of RELEVANT_PAGE_KEYWORDS) {
      if (href.toLowerCase().includes(keyword) || text.includes(keyword)) {
        if (!found.has(absolute)) found.set(absolute, type);
      }
    }
  });

  return found;
}

/**
 * Heuristic staff extraction: finds short text blocks containing a role
 * keyword, then checks the same line ("Name, Title") or the adjacent
 * element for a name-shaped string.
 */
function extractStaffFromPage(html, sourceUrl) {
  const $ = cheerio.load(html);
  const people = [];
  const allKeywords = Object.values(ROLE_CATEGORIES).flat().map((k) => k.trim());
  const keywordRegex = new RegExp(`\\b(${allKeywords.join("|")})\\b`, "i");

  $("h1, h2, h3, h4, p, li, span, div").each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, " ");
    if (!text || text.length > 120) return;
    if (!keywordRegex.test(text)) return;

    const inlineMatch = text.match(
      /^([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){1,3})\s*[,\-–|]\s*(.+)$/
    );
    if (inlineMatch) {
      const [, name, title] = inlineMatch;
      people.push({ name: name.trim(), title: title.trim(), sourceUrl });
      return;
    }

    const prevText = $(el).prev().text().trim();
    if (
      prevText &&
      prevText.length < 60 &&
      /^([A-Z][a-zA-Z.'-]+\s+){1,3}[A-Z][a-zA-Z.'-]+$/.test(prevText)
    ) {
      people.push({ name: prevText, title: text, sourceUrl });
    }
  });

  const seen = new Set();
  return people.filter((p) => {
    const key = `${p.name.toLowerCase()}|${p.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Full pipeline: fetch homepage, discover About/Contact/Team pages,
 * fetch those (respecting robots.txt), aggregate contacts + staff.
 */
export async function scrapeCompanyWebsite(url) {
  if (!url) {
    const error = new Error("A website URL is required");
    error.status = 400;
    throw error;
  }

  let baseUrl;
  try {
    baseUrl = new URL(url).toString();
  } catch {
    const error = new Error("Invalid URL");
    error.status = 400;
    throw error;
  }

  const allowed = await checkRobotsAllowed(baseUrl, new URL(baseUrl).pathname);
  if (!allowed) {
    return {
      url: baseUrl,
      scraped: false,
      reason: "Disallowed by robots.txt",
      emails: [],
      phones: [],
      decisionMakers: [],
    };
  }

  const homepageHtml = await fetchPage(baseUrl);
  if (!homepageHtml) {
    return {
      url: baseUrl,
      scraped: false,
      reason: "Could not fetch homepage",
      emails: [],
      phones: [],
      decisionMakers: [],
    };
  }

  const $ = cheerio.load(homepageHtml);
  const relevantLinks = findRelevantLinks($, baseUrl);
  const pagesToFetch = [baseUrl, ...relevantLinks.keys()].slice(0, MAX_PAGES);

  const emails = new Set(extractEmails(homepageHtml));
  const phones = new Set(extractPhones(homepageHtml));
  let staff = extractStaffFromPage(homepageHtml, baseUrl);

  for (const pageUrl of pagesToFetch.slice(1)) {
    const html = await fetchPage(pageUrl);
    if (!html) continue;
    extractEmails(html).forEach((e) => emails.add(e));
    extractPhones(html).forEach((p) => phones.add(p));
    staff = staff.concat(extractStaffFromPage(html, pageUrl));
  }

  const priority = { owner: 0, executive: 1, manager: 2, admin: 3, staff: 4 };
  const decisionMakers = staff
    .map((person) => ({ ...person, roleCategory: classifyRole(person.title) }))
    .filter((p) => p.roleCategory !== "unknown")
    .sort((a, b) => priority[a.roleCategory] - priority[b.roleCategory]);

  return {
    url: baseUrl,
    scraped: true,
    pagesChecked: pagesToFetch.length,
    emails: [...emails],
    phones: [...phones],
    decisionMakers,
  };
}

export default { scrapeCompanyWebsite };