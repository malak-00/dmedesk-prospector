// This copy of the frontend is served BY the Vercel project itself (see
// /vercel/README.md), so the API is same-origin -- "" means relative paths
// (fetch("/api/..."), no CORS needed at all). The docs/ and cloudflare/
// copies of this same file set this to the full
// https://dmedesk-prospector.vercel.app URL instead, since those are
// cross-origin to the API.
const VERCEL_API_URL = "";
