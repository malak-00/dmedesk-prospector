import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WEIGHTS } from '../src/lib/scoring.js';

// The database computes the fit score for sorting and filtering, with the
// Worker's weights passed in on every request. The SQL files carry the same
// numbers as defaults for when none are sent (and for the stored scores), so
// they must never drift from lib/scoring.js.
const sqlDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'sql');

// Finds `coalesce(nullif(<anything>->>'KEY', '')::integer, <default>)` and
// returns the default for each scoring key.
function defaultsIn(file) {
  const text = fs.readFileSync(path.join(sqlDir, file), 'utf8');
  const found = {};
  for (const key of Object.keys(WEIGHTS)) {
    const pattern = new RegExp(`->>'${key}', ''\\)::integer, (\\d+)\\)`);
    const match = text.match(pattern);
    found[key] = match ? Number(match[1]) : null;
  }
  return found;
}

test('sql/021 default score weights match lib/scoring.js', () => {
  assert.deepEqual(defaultsIn('021_search_insights.sql'), WEIGHTS);
});

test('sql/023 default score weights match lib/scoring.js', () => {
  assert.deepEqual(defaultsIn('023_provider_scores.sql'), WEIGHTS);
});
