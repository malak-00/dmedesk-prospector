#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { preflightCandidates, summarizePreflight } from '../../worker/src/services/leadPreflight.js';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/lead-intake/preflight.mjs <candidates.json>');
  process.exitCode = 2;
} else {
  const payload = JSON.parse(await readFile(inputPath, 'utf8'));
  const candidates = Array.isArray(payload) ? payload : payload.candidates;
  if (!Array.isArray(candidates)) throw new Error('Input must be an array or { candidates: [] }');
  const results = preflightCandidates(candidates, payload.context ?? {});
  console.log(JSON.stringify({ summary: summarizePreflight(results), results }, null, 2));
}