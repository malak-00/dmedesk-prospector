import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFunnel, leadStages } from '../src/lib/funnel.js';
import { noteKind } from '../src/lib/teamActivity.js';
import { claimForUser, enrichFromRegistry } from '../src/repos/leadsRepo.js';
import { flattenCompany } from '../src/lib/csvExport.js';

const line = (date, who, text) => `${date} 10:00 — ${who}: ${text}`;
const users = [{ id: 'a', display_name: 'Ana Lopez' }, { id: 'b', display_name: 'Ben Arthur' }];
const lead = (over) => ({ claimed_by: 'a', claimed_at: '2026-09-20T00:00:00Z', status: 'new', notes: '', meeting_at: null, specialty: 'DME', state: 'FL', ...over });

test('a lead counts at every stage it has reached, and never skips one', () => {
  assert.deepEqual(leadStages(lead({})), { claimed: true, contacted: false, booked: false, held: false, won: false });
  assert.equal(leadStages(lead({ notes: line('2026-09-21', 'Ana Lopez', 'Voicemail') })).contacted, true);
  assert.equal(leadStages(lead({ status: 'voicemail' })).contacted, true);
  const booked = leadStages(lead({ meeting_at: '2026-10-09T18:00:00Z' }));
  assert.deepEqual([booked.contacted, booked.booked, booked.held], [true, true, false], 'a booked meeting implies contact');
  const held = leadStages(lead({ notes: line('2026-09-25', 'Ana Lopez', 'Meeting held — went well') }));
  assert.deepEqual([held.booked, held.held, held.won], [true, true, false]);
  const won = leadStages(lead({ status: 'Onboarded' }));
  assert.deepEqual([won.contacted, won.booked, won.held, won.won], [true, true, true, true], 'onboarded implies everything before it');
  assert.equal(leadStages(lead({ status: 'Contract Sent' })).held, true);
  assert.equal(leadStages(lead({ status: 'Contract Sent' })).won, false);
});

test('copied-in sheet context is not counted as a call', () => {
  assert.equal(noteKind('Imported from BD MEETINGS — Opener: Ben'), 'import');
  assert.equal(leadStages(lead({ notes: line('2026-09-21', 'Ana Lopez', 'Imported from BD MEETINGS — Opener: Ben') })).contacted, false);
});

test('the funnel adds up by rep, specialty and state, and only counts claimed leads in range', () => {
  const leads = [
    lead({ claimed_by: 'a', status: 'Onboarded' }),
    lead({ claimed_by: 'a', notes: line('2026-09-21', 'Ana Lopez', 'Spoke to the owner') }),
    lead({ claimed_by: 'a' }),
    lead({ claimed_by: 'b', specialty: 'Pharmacy', state: 'TX', meeting_at: '2026-10-09T18:00:00Z' }),
    lead({ claimed_by: 'b', claimed_at: '2025-01-01T00:00:00Z', status: 'Onboarded' }), // before the range
    lead({ claimed_by: null, status: 'voicemail' }), // released: nobody's pipeline
  ];
  const since = Date.parse('2026-08-01T00:00:00Z');
  const funnel = buildFunnel({ leads, users, sinceMs: since });
  assert.deepEqual(funnel.stages.map((s) => [s.key, s.count]), [['claimed', 4], ['contacted', 3], ['booked', 2], ['held', 1], ['won', 1]]);
  const counts = funnel.stages.map((s) => s.count);
  assert.deepEqual(counts, [...counts].sort((x, y) => y - x), 'each stage is never bigger than the one before');
  assert.equal(funnel.stages[1].ofPrevious, 0.75);
  assert.equal(funnel.stages[4].ofClaimed, 0.25);
  const ana = funnel.reps.find((r) => r.label === 'Ana Lopez');
  assert.deepEqual([ana.claimed, ana.contacted, ana.won], [3, 2, 1]);
  assert.deepEqual(funnel.states.map((s) => [s.label, s.claimed]), [['FL', 3], ['TX', 1]]);
  assert.equal(buildFunnel({ leads, users, sinceMs: 0 }).total, 5, 'all time includes the older lead');
});

test('an empty funnel does not divide by zero', () => {
  const funnel = buildFunnel({ leads: [], users });
  assert.equal(funnel.total, 0);
  assert.ok(funnel.stages.every((s) => s.ofClaimed === 0 && s.ofPrevious === (s.key === 'claimed' ? 1 : 0)));
});

// ---- importing a sheet row on behalf of a rep --------------------------------------

const registryRow = {
  npi: '1134722390', name: 'CLAYTON MEDICAL SUPPLY INC', phone: '4048085118', address_line1: '1 Main St', address_city: 'Clayton',
  address_state: 'GA', address_postalcode: '30236', taxonomy_code: '332B00000X', taxonomy_description: 'DME',
  authorizedofficial_firstname: 'Judith', authorizedofficial_lastname: 'Fairclough', authorizedofficial_title: 'Owner', authorizedofficial_phone: '4048085119',
};

function fakeDb({ registry = [registryRow], dryVerdict, caller = { id: 'bot', is_admin: false, can_claim_for_others: true } } = {}) {
  const rpcCalls = [];
  const table = (name) => {
    const q = {
      select: () => q, eq: () => q, in: () => q, ilike: () => q, limit: () => q, maybeSingle: () => q,
      then(resolve) {
        if (name === 'npi_records') return resolve({ data: registry, error: null });
        if (name === 'app_users') return resolve({ data: caller.__user || [{ id: 'u1', username: 'ben', display_name: 'Ben Arthur' }], error: null });
        return resolve({ data: [], error: null });
      },
    };
    return q;
  };
  return {
    rpcCalls,
    from(name) {
      const q = table(name);
      if (name === 'app_users') {
        // permission check reads one row; username lookup reads a list
        let single = false;
        q.maybeSingle = () => { single = true; return q; };
        q.then = (resolve) => resolve(single ? { data: caller, error: null } : { data: [{ id: 'u1', username: 'ben', display_name: 'Ben Arthur' }], error: null });
      }
      return q;
    },
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (args.p_dry_run) return { data: dryVerdict || { claimed: [{ npi: '1134722390' }], skipped: [], blocked: [], held: [] }, error: null };
      return { data: { claimed: args.p_leads.map((l) => ({ npi: l.npi })), skipped: [], blocked: [], held: [] }, error: null };
    },
  };
}

const sheetRow = { npi: '1134722390', name: 'clayton med', phone: '404-808-5118 / 7709975660', email: 'a@b.co', authorizedOfficial: 'Judy F', status: 'Onboarded', notes: 'Imported from BD MEETINGS — Opener: Ben', meetingOpenerNotes: 'Ask about billing' };

test('a sheet row is filled in from the registry and keeps its status, notes and opener', async () => {
  const [filled] = await enrichFromRegistry(fakeDb(), [sheetRow]);
  assert.equal(filled.name, 'CLAYTON MEDICAL SUPPLY INC');
  assert.equal(filled.state, 'GA');
  assert.equal(filled.phone, '404-808-5118 / 7709975660', 'the sheet\'s own phone is kept');
  assert.equal(filled.authorizedOfficial, 'Judith Fairclough', 'the registry\'s owner takes part in grouping');
  assert.equal(filled.status, 'Onboarded');
});

test('claiming for a rep writes the sheet status and notes into the lead', async () => {
  const db = fakeDb();
  const result = await claimForUser(db, { id: 'bot', username: 'bd-bot' }, { username: 'ben', companies: [sheetRow] }, flattenCompany);
  const sent = db.rpcCalls.find((c) => c.name === 'claim_leads' && !c.args.p_dry_run).args;
  assert.equal(sent.p_user_id, 'u1');
  assert.equal(sent.p_actor_id, 'bot', 'the caller is recorded as the actor');
  const leadRow = sent.p_leads[0].lead;
  assert.equal(leadRow.status, 'Onboarded');
  assert.match(leadRow.notes, /Imported from BD MEETINGS/);
  assert.equal(leadRow.meeting_opener_notes, 'Ask about billing');
  assert.equal(leadRow.state, 'GA');
  assert.deepEqual(result.claimedNpis, ['1134722390']);
});

test('a normal claim from the search results is unchanged: status "new", no notes', async () => {
  const db = fakeDb();
  const company = { npi: '1134722390', name: 'X', address: { state: 'GA' }, decisionMakers: [], taxonomy: {}, medicare: null };
  await claimForUser(db, { id: 'bot', username: 'bd-bot' }, { username: 'ben', companies: [company] }, flattenCompany);
  const leadRow = db.rpcCalls.find((c) => c.name === 'claim_leads').args.p_leads[0].lead;
  assert.equal(leadRow.status, 'new');
  assert.equal(leadRow.notes, null);
  assert.equal('meeting_opener_notes' in leadRow, false);
});

test('a dry run says what would happen and writes nothing', async () => {
  const db = fakeDb({ dryVerdict: { claimed: [], skipped: [], blocked: [{ npi: '1134722390', companyName: 'X', owners: [{ displayName: 'Selene Myles' }] }], held: [] } });
  const result = await claimForUser(db, { id: 'bot', username: 'bd-bot' }, { username: 'ben', companies: [sheetRow], dryRun: true }, flattenCompany);
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.blocked.map((b) => b.owners), [['Selene Myles']]);
  assert.ok(db.rpcCalls.every((c) => c.args.p_dry_run === true), 'only the dry-run form of claim_leads was called');
});
