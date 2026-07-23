// Assembles the Cloudflare Pages dist folder from the shared vercel/ sources.
// Run: node build.js
// Output: cloudflare/dist/ (what CF Pages deploys)
//
// This keeps a single source of truth for index.html, app.js, style.css, etc.
// Only config.js is overridden (CF needs the full Vercel API URL, not "").

import { cpSync, copyFileSync, mkdirSync, rmSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const src = resolve(root, "vercel");
const dist = resolve(__dirname, "dist");

// Clean dist
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// Copy shared static files from vercel/
const shared = ["index.html", "app.js", "style.css", "usLocations.js"];
for (const file of shared) {
  copyFileSync(resolve(src, file), resolve(dist, file));
  console.log(`copied ${file}`);
}

// Copy icons directory
cpSync(resolve(src, "icons"), resolve(dist, "icons"), { recursive: true });
console.log("copied icons/");

// Override config.js with the CF-specific version
copyFileSync(resolve(__dirname, "config.js"), resolve(dist, "config.js"));
console.log("applied cloudflare/config.js (overrides vercel/config.js)");

// Copy _headers for security/CORS
try {
  copyFileSync(resolve(__dirname, "_headers"), resolve(dist, "_headers"));
  console.log("copied _headers");
} catch {
  // optional file
}

console.log(`\n✓ dist ready → ${dist}`);
