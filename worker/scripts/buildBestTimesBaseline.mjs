// Turns the team's earlier calling sheet (a CSV export with "Last Called", "Comments" and "State" columns) into the small
// file the Best times card adds to the live call logs: counts by weekday and hour, nothing about any lead.
//
//   node scripts/buildBestTimesBaseline.mjs "<path to the csv>"            (writes src/data/bestTimesBaseline.js)
//
// Re-run it with a newer export to refresh the numbers, then deploy the Worker.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildSheetBaseline } from "../src/lib/sheetCalls.js";

const require = createRequire(import.meta.url);
const { parseCsv } = require("../../docs/sheetlib.js");

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/buildBestTimesBaseline.mjs "<path to the sheet csv>"');
  process.exit(1);
}

const table = parseCsv(readFileSync(input, "utf8"));
const header = table[0].map((h) => String(h).replace(/\s+/g, " ").trim().toLowerCase());
const col = (name) => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`The sheet has no "${name}" column`);
  return i;
};
const [iState, iLast, iComments, iOwner] = [col("state"), col("last called"), col("comments"), col("owner")];
const rows = table.slice(1).filter((r) => r.some((c) => String(c).trim())).map((r) => ({ state: r[iState], lastCalled: r[iLast], comments: r[iComments], owner: r[iOwner] }));

const base = buildSheetBaseline(rows);
const out = {
  source: "earlier calling sheet (Last Called + Comments)",
  builtAt: new Date().toISOString().slice(0, 10),
  note: "Counts only: calls by the lead's local weekday (Mon to Fri) and hour (8 to 16). The time is the lead's last logged call, so leads that were reached stop being called.",
  rows: base.rows,
  counted: base.counted,
  ignored: base.ignored,
  outsideHours: base.outsideHours,
  grid: base.grid,
  // The same counts for each rep (first name as the sheet's Owner column has it), for the "Mine" view.
  byOwner: base.byOwner,
};
const target = fileURLToPath(new URL("../src/data/bestTimesBaseline.js", import.meta.url));
mkdirSync(fileURLToPath(new URL("../src/data/", import.meta.url)), { recursive: true });
writeFileSync(target, `// Written by scripts/buildBestTimesBaseline.mjs from the earlier calling sheet. Counts only: no lead, number or comment.\nexport default ${JSON.stringify(out)};\n`);
console.log(`rows ${out.rows}, counted ${out.counted}, ignored ${out.ignored}, outside 8-5 ${out.outsideHours}`);
const total = out.grid.flat().reduce((t, [n, a]) => [t[0] + n, t[1] + a], [0, 0]);
console.log(`answered ${total[1]} of ${total[0]} (${Math.round((total[1] / total[0]) * 100)}%)`);
console.log("reps:", Object.entries(out.byOwner).map(([k, g]) => `${k} ${g.flat().reduce((t, c) => t + c[0], 0)}`).join(", "));
console.log("by hour (answered / calls):");
for (let h = 0; h < 9; h += 1) {
  const n = out.grid.reduce((t, day) => t + day[h][0], 0);
  const a = out.grid.reduce((t, day) => t + day[h][1], 0);
  console.log(`  ${String(8 + h).padStart(2)}:00  ${String(a).padStart(4)} / ${String(n).padStart(4)}  ${n ? Math.round((a / n) * 100) + "%" : ""}`);
}
console.log("by day:");
["Mon", "Tue", "Wed", "Thu", "Fri"].forEach((name, d) => {
  const n = out.grid[d].reduce((t, c) => t + c[0], 0);
  const a = out.grid[d].reduce((t, c) => t + c[1], 0);
  console.log(`  ${name}  ${String(a).padStart(4)} / ${String(n).padStart(4)}  ${n ? Math.round((a / n) * 100) + "%" : ""}`);
});
