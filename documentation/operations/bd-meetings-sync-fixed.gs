// Replacement for syncNpiToProspector() in BD MEETINGS 2026 (Apps Script).
// Paste over the old function; setupProspectorSyncTrigger() stays as it is.
// Not deployed from this repo -- Ben's clasp project owns the live copy.
//
// REQUIRES the Worker with POST /admin/sync-lead-status deployed first (status + call date).
// Without it the claim step still works and the status step logs an error and carries on.
//
// What this does, per run:
//  1. CLAIM: rows with a valid NPI and SYNC unchecked are claimed in DME Desk for the opener
//     (status and notes go with the claim). SYNC is ticked when the lead is in DME Desk.
//  2. STATUS + CALL DATE: for every row with an NPI (synced or not), the sheet's Status and
//     "Last Call" are sent for the opener's leads. THE SHEET WINS on status. A row is only
//     re-sent when its status or Last Call changed since last time (remembered in the Script
//     Property PROSPECTOR_SYNC_SIGS), so a rep's later change in the app is not overwritten
//     every 2 hours -- only when the sheet row itself changes.
//  Nothing is written back from DME Desk into the sheet except the Log and SYNC cells.
//
// Triggers: every 2 hours (setupProspectorSyncTrigger below) and, if you want it, an installable
// "On change" trigger pointing at syncNpiToProspector. A script lock stops two runs overlapping.
//
// Columns are found by HEADER NAME on each tab (Opener, Status, Company Name, Phone, Last Call,
// NPI, SYNC, Log ...), not by fixed numbers.
//  - Skips SUB = Solar and George's rows; blank opener falls back to PROSPECTOR_USER_DEFAULT.
//  - Only a real phone / email goes in those fields (raw text goes to the notes).
//  - Does NOT send "Authorized Person" as the NPPES official (used for duplicate grouping);
//    it goes in the notes instead.
//
// Script Properties: PROSPECTOR_WORKER_URL, PROSPECTOR_BOT_USERNAME, PROSPECTOR_BOT_PASSWORD,
// PROSPECTOR_USER_<Opener> for every opener (Ben, Jane, Selene, Jimmy, Judy, Nora, Jasmine ...),
// PROSPECTOR_USER_DEFAULT.

function syncNpiToProspector() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('Prospector sync: another run is in progress -- skipping'); return; }
  try {
    runProspectorSync_();
  } finally {
    lock.releaseLock();
  }
}

function runProspectorSync_() {
  var props = PropertiesService.getScriptProperties();
  var workerUrl = (props.getProperty('PROSPECTOR_WORKER_URL') || '').replace(/\/$/, '');
  var botUsername = props.getProperty('PROSPECTOR_BOT_USERNAME');
  var botPassword = props.getProperty('PROSPECTOR_BOT_PASSWORD');
  var defaultUser = props.getProperty('PROSPECTOR_USER_DEFAULT') || '';
  if (!workerUrl || !botUsername || !botPassword) {
    Logger.log('Prospector sync: missing PROSPECTOR_WORKER_URL / BOT_USERNAME / BOT_PASSWORD -- skipping');
    return;
  }

  var SYNC_SHEETS = ['New Meetings', 'Follow Ups', 'Onboarded', 'Invoice Sent', 'Contract Sent', 'No-Show'];
  var CHUNK = 10;
  var STATUS_CHUNK = 50;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var entries = []; // one per sheet row with a usable NPI and owner

  SYNC_SHEETS.forEach(function (sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() < 2) return;
    var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
    var col = prospectorColumns_(values[0]);
    if (!col.npi || !col.sync) {
      Logger.log('Prospector sync: "' + sheetName + '" has no NPI / SYNC header -- skipping tab');
      return;
    }

    for (var i = 1; i < values.length; i++) {
      var row = values[i];
      var cell = function (c) { return c ? String(row[c - 1] === null || row[c - 1] === undefined ? '' : row[c - 1]).trim() : ''; };

      var npi = cell(col.npi).replace(/\D/g, '');
      if (npi.length !== 10) continue;

      var rowNum = i + 1;
      var already = row[col.sync - 1] === true || String(row[col.sync - 1]).toUpperCase() === 'TRUE';
      var setLog = function (msg) { if (col.log) sheet.getRange(rowNum, col.log).setValue(msg); };

      var sub = cell(col.sub);
      var opener = cell(col.opener);
      if (sub.toLowerCase() === 'solar') { if (!already) setLog('Skipped: Solar'); continue; }
      if (opener.toLowerCase() === 'george') { if (!already) setLog('Skipped: George'); continue; }

      var dmeUser = opener ? props.getProperty('PROSPECTOR_USER_' + opener) : defaultUser;
      if (!dmeUser) {
        if (!already) setLog(opener ? 'No DME user for opener "' + opener + '" (add PROSPECTOR_USER_' + opener + ')' : 'No opener and no default user');
        continue;
      }

      var rawPhone = cell(col.phone);
      var rawEmail = cell(col.email);
      var phoneMatch = rawPhone.match(/\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/);
      var emailMatch = rawEmail.match(/[^\s\/,;"]+@[^\s\/,;"]+\.[^\s\/,;"]+/);
      // The Status cell wins; a blank one falls back to the tab name only where the tab IS a status.
      // (A blank on New Meetings / Follow Ups / No-Show sends no status, so a new claim stays "new".)
      var status = cell(col.status) || ({ 'Onboarded': 'Onboarded', 'Contract Sent': 'Contract Sent', 'Invoice Sent': 'Invoice Sent' })[sheetName] || '';
      var lastCallAt = toIso_(col.lastCall ? row[col.lastCall - 1] : '');

      var notes = [];
      if (sub) notes.push('SUB: ' + sub);
      if (opener) notes.push('Opener: ' + opener);
      if (cell(col.authPerson)) notes.push('Authorized person: ' + cell(col.authPerson));
      if (rawPhone && (!phoneMatch || phoneMatch[0] !== rawPhone)) notes.push('Phone (as written): ' + rawPhone);
      if (rawEmail && (!emailMatch || emailMatch[0] !== rawEmail)) notes.push('Email (as written): ' + rawEmail);

      entries.push({
        sheet: sheet, rowNum: rowNum, syncCol: col.sync, logCol: col.log, npi: npi, dmeUser: dmeUser,
        pending: !already, status: status, lastCallAt: lastCallAt,
        company: {
          npi: npi,
          name: cell(col.company),
          phone: phoneMatch ? phoneMatch[0] : '',
          email: emailMatch ? emailMatch[0] : '',
          status: status,
          notes: notes.join('\n'),
          meetingOpenerNotes: cell(col.openerSummary),
          contactSource: 'bd-meetings',
          sources: 'BD Meetings'
        }
      });
    }
  });

  if (entries.length === 0) { Logger.log('Prospector sync: nothing to do'); return; }

  var token = loginBot_(workerUrl, botUsername, botPassword);
  if (!token) return;

  // ---- 1. CLAIM the rows whose SYNC box is unchecked ----------------------------------
  var pending = entries.filter(function (e) { return e.pending; });
  groupBy_(pending, 'dmeUser', function (dmeUser, items) {
    for (var c = 0; c < items.length; c += CHUNK) {
      var chunk = items.slice(c, c + CHUNK);

      // One company per NPI per request; every sheet row with that NPI gets the same verdict.
      var seen = {}, companies = [];
      chunk.forEach(function (it) { if (!seen[it.npi]) { seen[it.npi] = true; companies.push(it.company); } });

      var data;
      try {
        data = postJson_(workerUrl + '/admin/claim-for-user', token, { username: dmeUser, companies: companies });
      } catch (err) {
        Logger.log('Prospector sync: claim failed for ' + dmeUser + ': ' + err.message);
        chunk.forEach(function (it) { writeLog_(it, 'Sync error: ' + err.message); });
        continue; // SYNC stays unchecked -> retried next run
      }

      var verdict = {};
      (data.claimedNpis || []).forEach(function (n) { verdict[String(n)] = { ok: true, msg: 'Claimed in DME Desk' }; });
      (data.alreadyClaimedNpis || []).forEach(function (n) { verdict[String(n)] = { ok: true, msg: 'Already owned' }; });
      (data.blocked || []).forEach(function (b) { verdict[String(b.npi)] = { ok: false, msg: 'Blocked: owned by ' + (b.owners || []).join(', ') }; });
      (data.heldForReview || []).forEach(function (h) { verdict[String(h.npi)] = { ok: false, msg: 'Held for admin review (possible duplicate)' }; });
      (data.invalid || []).forEach(function (v) { verdict[String(v.npi)] = { ok: false, msg: 'Invalid: ' + (v.reason || 'not accepted') }; });

      chunk.forEach(function (it) {
        var v = verdict[it.npi] || { ok: false, msg: 'No result returned' };
        if (v.ok) it.sheet.getRange(it.rowNum, it.syncCol).setValue(true);
        it.claimed = v.ok;
        writeLog_(it, v.msg);
      });
    }
  });

  // ---- 2. STATUS + CALL DATE: the sheet wins ------------------------------------------
  // Rows that were pending and were not claimed (blocked / held) are not the opener's lead
  // in DME Desk, so there is nothing to update for them.
  var props2 = PropertiesService.getScriptProperties();
  var sigs = {};
  try { sigs = JSON.parse(props2.getProperty('PROSPECTOR_SYNC_SIGS') || '{}'); } catch (e) { sigs = {}; }

  var toSend = entries.filter(function (e) {
    if (e.pending && !e.claimed) return false;
    if (!e.status && !e.lastCallAt) return false;
    return sigs[e.dmeUser + '|' + e.npi] !== statusSig_(e);
  });

  groupBy_(toSend, 'dmeUser', function (dmeUser, items) {
    for (var c = 0; c < items.length; c += STATUS_CHUNK) {
      var chunk = items.slice(c, c + STATUS_CHUNK);
      var seen = {}, leads = [];
      chunk.forEach(function (it) {
        if (seen[it.npi]) return;
        seen[it.npi] = true;
        leads.push({ npi: it.npi, status: it.status, lastCallAt: it.lastCallAt });
      });

      var data;
      try {
        data = postJson_(workerUrl + '/admin/sync-lead-status', token, { username: dmeUser, leads: leads });
      } catch (err) {
        Logger.log('Prospector sync: status sync failed for ' + dmeUser + ': ' + err.message);
        continue; // signature not stored -> retried next run
      }

      var updated = {}, unchanged = {}, notOwned = {};
      (data.updated || []).forEach(function (n) { updated[String(n)] = true; });
      (data.unchanged || []).forEach(function (n) { unchanged[String(n)] = true; });
      (data.notOwned || []).forEach(function (n) { notOwned[String(n)] = true; });

      chunk.forEach(function (it) {
        if (updated[it.npi] || unchanged[it.npi]) {
          sigs[it.dmeUser + '|' + it.npi] = statusSig_(it);
          if (updated[it.npi] && !it.pending) writeLog_(it, 'Status synced: ' + it.status);
        } else if (notOwned[it.npi]) {
          writeLog_(it, 'Not synced: this lead is owned by someone else in DME Desk');
        }
      });
    }
  });
  props2.setProperty('PROSPECTOR_SYNC_SIGS', JSON.stringify(sigs));
}

function statusSig_(entry) { return entry.status + '|' + (entry.lastCallAt || ''); }

// Calls fn(key, items) once per distinct value of items[field].
function groupBy_(items, field, fn) {
  var groups = {};
  items.forEach(function (it) { (groups[it[field]] = groups[it[field]] || []).push(it); });
  Object.keys(groups).forEach(function (k) { fn(k, groups[k]); });
}

function loginBot_(workerUrl, username, password) {
  try {
    var resp = UrlFetchApp.fetch(workerUrl + '/auth/login', {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ username: username, password: password }),
      muteHttpExceptions: true
    });
    var json = JSON.parse(resp.getContentText());
    if (!json.success) throw new Error(json.error || 'login failed');
    return json.data.token;
  } catch (err) {
    Logger.log('Prospector sync: bot login failed -- ' + err.message);
    return null;
  }
}

function postJson_(url, token, body) {
  var resp = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  var json;
  try { json = JSON.parse(resp.getContentText()); }
  catch (e) { throw new Error('HTTP ' + resp.getResponseCode()); }
  if (!json.success) throw new Error(json.error || ('HTTP ' + resp.getResponseCode()));
  return json.data || {};
}

// A Date from the sheet, or text like "3/6/2026 20:23:04", as an ISO string; '' when it is not a date.
function toIso_(value) {
  if (value === '' || value === null || value === undefined) return '';
  var d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function writeLog_(item, msg) {
  if (item.logCol) item.sheet.getRange(item.rowNum, item.logCol).setValue(msg);
}

// Replaces the 30-minute trigger with a 2-hour one. Run once from the Apps Script editor.
// For the "when a lead is added" trigger: Triggers > Add trigger > syncNpiToProspector >
// From spreadsheet > On change (the script lock above stops it overlapping the 2-hour run).
function setupProspectorSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncNpiToProspector' && t.getEventType() === ScriptApp.EventType.CLOCK) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncNpiToProspector').timeBased().everyHours(2).create();
  SpreadsheetApp.getUi().alert('Prospector sync trigger created (runs every 2 hours).');
}

// Header text -> 1-based column. Matches the real headers on the BD tabs.
function prospectorColumns_(headerRow) {
  var map = {};
  headerRow.forEach(function (h, idx) {
    var t = String(h || '').trim().toLowerCase();
    var c = idx + 1;
    if (t === 'npi') map.npi = c;
    else if (t === 'sync') map.sync = c;
    else if (t === 'log') map.log = c;
    else if (t === 'opener') map.opener = c;
    else if (t === 'sub') map.sub = c;
    else if (t === 'status') map.status = c;
    else if (t === 'last call') map.lastCall = c;
    else if (t === 'company name') map.company = c;
    else if (t === 'authorized person') map.authPerson = c;
    else if (t === 'phone') map.phone = c;
    else if (t === 'email') map.email = c;
    else if (t === 'opener summary') map.openerSummary = c;
  });
  return map;
}
