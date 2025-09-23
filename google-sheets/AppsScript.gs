/** ===== CONFIG from Script Properties =====
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE, EVENT_ID
 */
function CONFIG() {
  const props = PropertiesService.getScriptProperties();
  const SUPABASE_URL = props.getProperty('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE = props.getProperty('SUPABASE_SERVICE_ROLE');
  const EVENT_ID = props.getProperty('EVENT_ID');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !EVENT_ID) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE / EVENT_ID in Script Properties.');
  }
  return { SUPABASE_URL, SUPABASE_SERVICE_ROLE, EVENT_ID };
}

const SHEET_NAMES = ['N_H','N_D','M_H','M_D','S_H','S_D','R_H','R_D'];
const RESULT_CATEGORIES = ['N','M','S','R'];
const RESULT_SHEET_NAMES = {
  N: 'Výsledky N',
  M: 'Výsledky M',
  S: 'Výsledky S',
  R: 'Výsledky R'
};
const RESULT_HEADERS = [
  'Kategorie',
  'Pohlaví',
  'Pořadí',
  'Kód hlídky',
  'Oddíl / tým',
  'Členové hlídky',
  'Body celkem',
  'Body bez T',
  'Čistý čas (s)'
];
const TABLE = 'patrols';

function headers_() {
  const { SUPABASE_SERVICE_ROLE } = CONFIG();
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_ROLE,
    'Authorization': 'Bearer ' + SUPABASE_SERVICE_ROLE,
    'Prefer': 'resolution=merge-duplicates'
  };
}

function genCode_(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function ensureSheet_(name) {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function log_(message, level = 'INFO') {
  const sh = ensureSheet_('SyncLog');
  sh.appendRow([new Date(), level, String(message)]);
}

function fetchExistingCodes_() {
  const { SUPABASE_URL, EVENT_ID } = CONFIG();
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?select=patrol_code&event_id=eq.${EVENT_ID}`;
  const res = UrlFetchApp.fetch(url, { method: 'get', headers: headers_(), muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) throw new Error('Fetch existing codes failed: ' + res.getContentText());
  const list = JSON.parse(res.getContentText());
  return new Set(list.map(x => x.patrol_code));
}

function normalizeString_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function parseStartTime_(value) {
  if (value === null || value === undefined || value === '') {
    return { present: true, value: null };
  }

  if (value instanceof Date) {
    return { present: true, value: value.toISOString() };
  }

  const str = String(value).trim();
  if (!str) {
    return { present: true, value: null };
  }

  const parsed = new Date(str);
  if (!isFinite(parsed.getTime())) {
    throw new Error(`Invalid start_time value: ${value}`);
  }

  return { present: true, value: parsed.toISOString() };
}

function readSheet_(name, existingCodes, batchCodes) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) return [];
  const values = sh.getDataRange().getValues();
  if (!values.length) return [];
  const header = values.shift().map(h => String(h).trim().toLowerCase());

  const idx = (c) => header.indexOf(c);
  const iTeam = idx('team_name');
  const iCode = idx('patrol_code');
  const iChild1 = idx('child1');
  const iChild2 = idx('child2');
  const iChild3 = idx('child3');
  const iStartTime = idx('start_time');
  const iNote = idx('note');
  const iActive = idx('active');

  if (iTeam < 0 || iCode < 0) {
    throw new Error(`Sheet "${name}" must have columns team_name and patrol_code.`);
  }

  const [category, sex] = name.split('_'); // "N","H"
  const updates = [];

  values.forEach((row, r) => {
    const team = String(row[iTeam] || '').trim();
    if (!team) return;

    let code = String(row[iCode] || '').trim();
    const childNames = [iChild1, iChild2, iChild3]
      .filter(index => index >= 0)
      .map(index => normalizeString_(row[index]))
      .filter(Boolean);

    const members = childNames.join(', ');

    const rawNote = iNote >= 0 ? normalizeString_(row[iNote]) : '';
    const activeStr = iActive >= 0 ? String(row[iActive] || '').trim().toLowerCase() : 'yes';
    const active = ['yes','true','1','ano','y'].includes(activeStr);

    let startTime = { present: false, value: null };
    if (iStartTime >= 0) {
      startTime = parseStartTime_(row[iStartTime]);
    }

    const combinedNoteParts = [];
    if (members) combinedNoteParts.push(members);
    if (rawNote) combinedNoteParts.push(rawNote);
    const combinedNote = combinedNoteParts.join('\n');

    if (!['N','M','S','R'].includes(category) || !['H','D'].includes(sex)) {
      throw new Error(`Sheet name must be X_Y (X∈{N,M,S,R}, Y∈{H,D}). Problem: ${name}`);
    }

    if (!code) {
      let attempts = 0;
      do {
        code = genCode_();
        attempts++;
        if (attempts > 20) throw new Error('Failed to generate unique patrol_code.');
      } while (existingCodes.has(code) || batchCodes.has(code));
      sh.getRange(r + 2, iCode + 1).setValue(code);
      batchCodes.add(code);
    } else {
      if (batchCodes.has(code)) {
        throw new Error(`Duplicate patrol_code "${code}" in sheet ${name}.`);
      }
      batchCodes.add(code);
    }

    updates.push({
      patrol: {
        event_id: CONFIG().EVENT_ID,
        team_name: team,
        category,
        sex,
        patrol_code: code,
        note: combinedNote,
        active
      },
      meta: {
        patrol_code: code,
        members,
        note: rawNote,
        start_time_present: startTime.present,
        start_time_value: startTime.value
      }
    });
  });

  return updates;
}

function upsertBatched_(entries, batchSize = 200) {
  const { SUPABASE_URL } = CONFIG();
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?on_conflict=patrol_code,event_id`;
  for (let i = 0; i < entries.length; i += batchSize) {
    const chunk = entries.slice(i, i + batchSize).map(entry => entry.patrol);
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: headers_(),
      payload: JSON.stringify(chunk),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code >= 300) {
      throw new Error(`Supabase upsert error ${code}: ${res.getContentText()}`);
    }
  }
}

function fetchPatrolIds_() {
  const { SUPABASE_URL, EVENT_ID } = CONFIG();
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?select=id,patrol_code&event_id=eq.${EVENT_ID}`;
  const res = UrlFetchApp.fetch(url, { method: 'get', headers: headers_(), muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) {
    throw new Error('Fetching patrol ids failed: ' + res.getContentText());
  }
  const list = JSON.parse(res.getContentText());
  const map = new Map();
  list.forEach(item => { map.set(item.patrol_code, item.id); });
  return map;
}

function upsertStartTimes_(entries) {
  const updates = entries
    .filter(entry => entry.meta && entry.meta.start_time_present)
    .map(entry => ({
      patrol_code: entry.meta.patrol_code,
      start_time: entry.meta.start_time_value
    }));

  if (!updates.length) return 0;

  const patrolIdMap = fetchPatrolIds_();
  const rows = [];

  updates.forEach(update => {
    if (!patrolIdMap.has(update.patrol_code)) {
      log_(`Missing patrol for start_time sync: ${update.patrol_code}`, 'WARN');
      return;
    }
    rows.push({
      event_id: CONFIG().EVENT_ID,
      patrol_id: patrolIdMap.get(update.patrol_code),
      start_time: update.start_time
    });
  });

  if (!rows.length) return 0;

  const { SUPABASE_URL } = CONFIG();
  const url = `${SUPABASE_URL}/rest/v1/timings?on_conflict=event_id,patrol_id`;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: headers_(),
    payload: JSON.stringify(rows),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() >= 300) {
    throw new Error('Supabase timing upsert error: ' + res.getContentText());
  }

  return rows.length;
}

function syncToSupabase() {
  const lock = LockService.getScriptLock();
  try {
    lock.tryLock(20000);

    const existingCodes = fetchExistingCodes_();
    const batchCodes = new Set();
    let allEntries = [];
    ['N_H','N_D','M_H','M_D','S_H','S_D','R_H','R_D'].forEach(name => {
      const rows = readSheet_(name, existingCodes, batchCodes);
      allEntries = allEntries.concat(rows);
    });

    if (!allEntries.length) { log_('Nothing to upsert.'); return; }
    upsertBatched_(allEntries);
    const timingUpdates = upsertStartTimes_(allEntries);
    const message = timingUpdates
      ? `Upsert done: ${allEntries.length} rows (timings updated: ${timingUpdates}).`
      : `Upsert done: ${allEntries.length} rows.`;
    log_(message);

  } catch (e) {
    log_(e.stack || e.message, 'ERROR');
    throw e;
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function toNumberOrEmpty_(value) {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  return isFinite(num) ? num : value;
}

function fetchRankedResults_() {
  const { SUPABASE_URL, EVENT_ID } = CONFIG();
  const base = `${SUPABASE_URL}/rest/v1/results_ranked`;
  const query = [
    'select=category,sex,rank_in_bracket,team_name,patrol_code,total_points,points_no_T,pure_seconds,patrol_members',
    `event_id=eq.${EVENT_ID}`,
    'order=category.asc',
    'order=sex.asc',
    'order=rank_in_bracket.asc'
  ].join('&');
  const res = UrlFetchApp.fetch(`${base}?${query}`, { method: 'get', headers: headers_(), muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) {
    throw new Error('Supabase results export failed: ' + res.getContentText());
  }
  return JSON.parse(res.getContentText());
}

function writeResultsToSheets_(rows) {
  const grouped = {};
  RESULT_CATEGORIES.forEach(cat => { grouped[cat] = []; });

  rows.forEach(row => {
    const cat = row.category;
    if (!cat) return;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(row);
  });

  RESULT_CATEGORIES.forEach(cat => {
    const sheetName = RESULT_SHEET_NAMES[cat] || `Výsledky ${cat}`;
    const sh = ensureSheet_(sheetName);
    sh.clearContents();
    sh.getRange(1, 1, 1, RESULT_HEADERS.length).setValues([RESULT_HEADERS]);
    sh.setFrozenRows(1);

    const data = grouped[cat] || [];
    if (data.length) {
      const values = data.map(row => [
        row.category || cat,
        row.sex || '',
        toNumberOrEmpty_(row.rank_in_bracket),
        row.patrol_code || '',
        row.team_name || '',
        row.patrol_members || '',
        toNumberOrEmpty_(row.total_points),
        toNumberOrEmpty_(row.points_no_T),
        toNumberOrEmpty_(row.pure_seconds)
      ]);
      sh.getRange(2, 1, values.length, RESULT_HEADERS.length).setValues(values);
    }

    sh.autoResizeColumns(1, RESULT_HEADERS.length);
  });
}

function exportResultsToSheets() {
  const lock = LockService.getScriptLock();
  try {
    lock.tryLock(20000);
    const rows = fetchRankedResults_();
    writeResultsToSheets_(rows);
    log_(`Results export done: ${rows.length} rows.`);
  } catch (e) {
    log_(e.stack || e.message, 'ERROR');
    throw e;
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Seton')
    .addItem('Synchronizovat teď', 'syncToSupabase')
    .addItem('Exportovat výsledky', 'exportResultsToSheets')
    .addToUi();
}
