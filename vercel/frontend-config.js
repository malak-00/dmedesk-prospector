// Fill these in after deploying the Apps Script Web App (see README's
// "Free, no-card deployment" section). Nothing sensitive goes here except
// the shared team access code -- the real API keys live in Apps Script's
// Script Properties, never in this repo.

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbywy89pKrOYGDcNdzMNcjxR02sBXJhQojittf4zyG1_WKaVLHU4Yh4UoVKYizzKxifzAw/exec";

// This copy of the frontend is served BY the Vercel project itself (see
// /vercel/README.md), so the new API is same-origin -- "" means relative
// paths (fetch("/api/..."), no CORS needed at all). The docs/ and
// cloudflare/ copies of this same file set this to the full
// https://dmedesk-prospector.vercel.app URL instead, since those are
// cross-origin to the API.
const VERCEL_API_URL = "";
