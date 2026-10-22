import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureUserTab } from '../src/services/googleSheets.js';

// Stands in for the Google Sheets API: `tabs` is the spreadsheet's tab list, and
// `onAdd` decides what creating a tab does.
function withFakeSheets(tabs, onAdd) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    if (String(url).includes(':batchUpdate')) return onAdd(JSON.parse(options.body), tabs);
    return { ok: true, json: async () => ({ sheets: tabs.map((title, i) => ({ properties: { title, sheetId: 100 + i } })) }), text: async () => '' };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}
const created = (title, tabs) => { tabs.push(title); return { ok: true, json: async () => ({ replies: [{ addSheet: { properties: { sheetId: 900 } } }] }), text: async () => '' }; };
const alreadyExists = (title) => ({ ok: false, status: 400, text: async () => `Invalid requests[0].addSheet: A sheet with the name "${title}" already exists. Please enter another name.`, statusText: 'Bad Request' });

test('an existing tab is used as it is', async () => {
  const fake = withFakeSheets(['Claimed - Ana'], created);
  try {
    const tab = await ensureUserTab('t', 'sheet-1', 'Claimed - Ana');
    assert.deepEqual([tab.created, tab.title, tab.sheetId], [false, 'Claimed - Ana', 100]);
    assert.equal(fake.calls.some((c) => c.url.includes(':batchUpdate')), false, 'nothing is created');
  } finally { fake.restore(); }
});

test('a tab that differs only in capitals is the same tab, and is written to under its real name', async () => {
  const fake = withFakeSheets(['Claimed - Selene Myles'], (body) => alreadyExists(body.requests[0].addSheet.properties.title));
  try {
    const tab = await ensureUserTab('t', 'sheet-1', 'Claimed - Selene myles');
    assert.deepEqual([tab.created, tab.title], [false, 'Claimed - Selene Myles']);
    assert.equal(fake.calls.some((c) => c.url.includes(':batchUpdate')), false, 'no attempt to create a duplicate');
  } finally { fake.restore(); }
});

test('a missing tab is created', async () => {
  const fake = withFakeSheets(['Claimed - Ana'], created);
  try {
    const tab = await ensureUserTab('t', 'sheet-1', 'Claimed - Ben');
    assert.deepEqual([tab.created, tab.title, tab.sheetId], [true, 'Claimed - Ben', 900]);
  } finally { fake.restore(); }
});

test('if the tab appears while it is being created (two exports at once), the one that is there is used', async () => {
  const tabs = [];
  const fake = withFakeSheets(tabs, (body) => { tabs.push(body.requests[0].addSheet.properties.title); return alreadyExists(body.requests[0].addSheet.properties.title); });
  try {
    const tab = await ensureUserTab('t', 'sheet-1', 'Claimed - Selene myles');
    assert.deepEqual([tab.created, tab.title], [false, 'Claimed - Selene myles']);
  } finally { fake.restore(); }
});

test('any other Google error still fails', async () => {
  const fake = withFakeSheets([], () => ({ ok: false, status: 403, text: async () => 'The caller does not have permission', statusText: 'Forbidden' }));
  try {
    await assert.rejects(() => ensureUserTab('t', 'sheet-1', 'Claimed - Ana'), (err) => err.status === 502 && /permission/.test(err.message));
  } finally { fake.restore(); }
});
