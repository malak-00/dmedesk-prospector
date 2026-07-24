// The Vercel + Supabase API's base URL (see /vercel) -- every feature in
// this app talks to it now (Google sign-in, search, claimed leads,
// taxonomies). This copy of the frontend (served from GitHub Pages) is
// cross-origin to that API, so this needs the full URL, not a relative
// path -- see vercel/frontend-config.js's copy of this file for the
// same-origin version served directly by the Vercel project itself.
const VERCEL_API_URL = "https://dmedesk-prospector.vercel.app";
