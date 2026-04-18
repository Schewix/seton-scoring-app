/**
 * Optimized Google Apps Script for patrol registration/start-time assignment.
 *
 * Main goals:
 * - minimize Spreadsheet API calls (batch reads/writes),
 * - keep behavior compatible with original helpers,
 * - protect critical sections for concurrent edits (DocumentLock),
 * - avoid unnecessary SpreadsheetApp.flush() calls.
 */

const TARGET_SHEET_NAMES_ = Object.freeze([
  '2. PTO Poutníci',
  '6. PTO Nibowaka',
  '10. PTO Severka',
  '11. PTO Iktómi',
  '14.TSP Zeměpisná společnost "PCV"',
  '21. PTO Hády',
  '32. PTO Severka',
  '34. PTO Tulák',
  '48. PTO Stezka',
  '63. PTO Phoenix',
  '64. PTO Lorien',
  '66. PTO Brabrouci',
  '99. PTO Kamzíci',
  '111. PTO Vinohrady',
  '176. PTO Vlčata',
  'Duha Expedice',
  'Žabky Jedovnice',
  'Smíšené hlídky',
  'Template Účastníci',
]);

const TARGET_SHEET_NAME_SET_ = (() => {
  const out = Object.create(null);
  TARGET_SHEET_NAMES_.forEach((name) => {
    out[name] = true;
  });
  return out;
})();

const DATA_START_ROW_ = 4;
const TIMES_SHEET_NAME_ = 'Časy - nastavení';
const EXPORT_SHEET_NAME_ = 'Všechny hlídky';
const MIN_START_OFFSET_MINUTES_ = 20;
const LOCK_TIMEOUT_MS_ = 5000;
const EXPORT_DEBOUNCE_DELAY_MS_ = 30 * 1000;
const EXPORT_DEBOUNCE_HANDLER_ = 'runDebouncedExportSync_';

/**
 * Supported values:
 * - 'immediate'
 * - 'debounce'
 * - 'immediate_and_debounce'
 * - 'off'
 */
const EXPORT_SYNC_MODE_ = 'immediate_and_debounce';

const EXPORT_SYNC_DIRTY_AT_PROP_ = 'registration_sync.export_dirty_at_ms';
const EXPORT_SYNC_DIRTY_SOURCE_PROP_ = 'registration_sync.export_dirty_source';
const EXPORT_SYNC_DEBOUNCE_TRIGGER_ID_PROP_ = 'registration_sync.export_trigger_id';

const DEFAULT_LAYOUT_ = Object.freeze({
  categoryCol: 17, // Q
  patrolNoCol: 19, // S
  startTimeCol: 22, // V
  registeredCol: 23, // W

  child1TeamCol: null,
  child1FirstCol: 2, // B
  child1LastCol: 3, // C
  child1NickCol: 4, // D

  child2TeamCol: null,
  child2FirstCol: 7, // G
  child2LastCol: 8, // H
  child2NickCol: 9, // I

  child3TeamCol: null,
  child3FirstCol: 12, // L
  child3LastCol: 13, // M
  child3NickCol: 14, // N
});

const MIXED_LAYOUT_ = Object.freeze({
  categoryCol: 20, // T
  patrolNoCol: 22, // V
  startTimeCol: 25, // Y
  registeredCol: 26, // Z

  child1TeamCol: 2, // B
  child1FirstCol: 3, // C
  child1LastCol: 4, // D
  child1NickCol: 5, // E

  child2TeamCol: 8, // H
  child2FirstCol: 9, // I
  child2LastCol: 10, // J
  child2NickCol: 11, // K

  child3TeamCol: 14, // N
  child3FirstCol: 15, // O
  child3LastCol: 16, // P
  child3NickCol: 17, // Q
});

const SLOT_TO_TIMES_COL_ = Object.freeze({
  N: 1, // A
  MH: 2, // B
  MD: 3, // C
  SH: 4, // D
  SD: 5, // E
  R: 6, // F
});

const ALL_SLOTS_ = Object.freeze(['N', 'MH', 'MD', 'SH', 'SD', 'R']);

function shouldRunImmediateExportSync_() {
  return EXPORT_SYNC_MODE_ === 'immediate' || EXPORT_SYNC_MODE_ === 'immediate_and_debounce';
}

function shouldQueueDebouncedExportSync_() {
  return EXPORT_SYNC_MODE_ === 'debounce' || EXPORT_SYNC_MODE_ === 'immediate_and_debounce';
}

function getSyncScriptProperties_() {
  return PropertiesService.getScriptProperties();
}

function getTargetSheetNames_() {
  return TARGET_SHEET_NAMES_.slice();
}

function normalizeValue_(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function isRegistered_(value) {
  return value === true;
}

function getSpreadsheetTimezone_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || 'Europe/Prague';
}

function isDateValue_(value) {
  return Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value);
}

function normalizeTimeKey_(value, timezone) {
  if (value === '' || value === null) return '';
  if (isDateValue_(value)) {
    return Utilities.formatDate(value, timezone, 'HH:mm');
  }
  const text = String(value).trim();
  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return text;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function timeToMinutes_(value, timezone) {
  const key = normalizeTimeKey_(value, timezone);
  const match = key.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function getNowMinutesInTimezone_(timezone) {
  const nowKey = Utilities.formatDate(new Date(), timezone, 'HH:mm');
  const match = nowKey.match(/^(\d{2}):(\d{2})$/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function getStartSlotFromCategory_(category) {
  const c = normalizeValue_(category);

  if (c === 'NH' || c === 'ND') return 'N';
  if (c === 'MH') return 'MH';
  if (c === 'MD') return 'MD';
  if (c === 'SH') return 'SH';
  if (c === 'SD') return 'SD';
  if (c === 'RH' || c === 'RD') return 'R';

  return '';
}

function getAllTimesForSlot_(timesSheet, slot) {
  const allBySlot = getAllTimesBySlot_(timesSheet);
  return allBySlot[slot] ? allBySlot[slot].slice() : [];
}

function getAllTimesBySlot_(timesSheet) {
  const out = createEmptySlotValueMap_();
  const lastRow = timesSheet.getLastRow();
  if (lastRow < 2) return out;

  const rowCount = lastRow - 1;
  const values = timesSheet.getRange(2, 1, rowCount, 6).getValues();

  values.forEach((row) => {
    ALL_SLOTS_.forEach((slot) => {
      const colIndex = SLOT_TO_TIMES_COL_[slot] - 1;
      const value = row[colIndex];
      if (value === '' || value === null) return;
      out[slot].push(value);
    });
  });

  return out;
}

function getSheetLayout_(sheetName) {
  if (sheetName === 'Smíšené hlídky') {
    return MIXED_LAYOUT_;
  }
  return DEFAULT_LAYOUT_;
}

function createEmptyUsedBySlot_() {
  return {
    N: new Set(),
    MH: new Set(),
    MD: new Set(),
    SH: new Set(),
    SD: new Set(),
    R: new Set(),
  };
}

function createEmptySlotValueMap_() {
  return {
    N: [],
    MH: [],
    MD: [],
    SH: [],
    SD: [],
    R: [],
  };
}

function getUsedTimesBySlot_(ss, timezone) {
  const usedBySlot = createEmptyUsedBySlot_();

  getTargetSheetNames_().forEach((sheetName) => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;

    const lastRow = sheet.getLastRow();
    if (lastRow < DATA_START_ROW_) return;

    const layout = getSheetLayout_(sheetName);
    const rowCount = lastRow - DATA_START_ROW_ + 1;
    const maxCol = Math.max(layout.categoryCol, layout.startTimeCol);
    const values = sheet.getRange(DATA_START_ROW_, 1, rowCount, maxCol).getValues();

    values.forEach((row) => {
      const category = row[layout.categoryCol - 1];
      const startTime = row[layout.startTimeCol - 1];
      const slot = getStartSlotFromCategory_(category);
      if (!slot) return;

      const key = normalizeTimeKey_(startTime, timezone);
      if (!key) return;

      usedBySlot[slot].add(key);
    });
  });

  return usedBySlot;
}

function nowInTimezoneMs_(timezone) {
  const now = new Date();
  const datePart = Utilities.formatDate(now, timezone, 'yyyy-MM-dd');
  const timePart = Utilities.formatDate(now, timezone, 'HH:mm:ss');
  return new Date(`${datePart}T${timePart}`).getTime();
}

function timeTodayMs_(value, timezone) {
  if (value === '' || value === null) return null;

  const mins = timeToMinutes_(value, timezone);
  if (mins === null) return null;

  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  const now = new Date();
  const datePart = Utilities.formatDate(now, timezone, 'yyyy-MM-dd');
  return new Date(`${datePart}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`).getTime();
}

function acquireDocumentLockOrThrow_() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS_)) {
    throw new Error('Unable to acquire document lock within timeout.');
  }
  return lock;
}

function pickFirstFreeTimeForSlot_(slot, timesBySlot, usedBySlot, timezone, minAllowedMinutes) {
  const candidates = timesBySlot[slot] || [];
  const used = usedBySlot[slot];
  if (!used) return null;

  let bestCandidate = null;
  let bestKey = '';
  let bestMinutes = Number.POSITIVE_INFINITY;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const key = normalizeTimeKey_(candidate, timezone);
    if (!key) continue;
    if (used.has(key)) continue;

    const candidateMinutes = timeToMinutes_(candidate, timezone);
    if (candidateMinutes === null) continue;
    if (candidateMinutes < minAllowedMinutes) continue;
    if (candidateMinutes >= bestMinutes) continue;

    bestCandidate = candidate;
    bestKey = key;
    bestMinutes = candidateMinutes;
  }

  if (bestCandidate === null) return null;
  used.add(bestKey);
  return bestCandidate;
}

function processRegistrationRowsUnsafe_(sheet, startRow, rowCount, runtime) {
  if (rowCount <= 0) return false;

  const layout = getSheetLayout_(sheet.getName());
  const maxCol = Math.max(layout.categoryCol, layout.startTimeCol, layout.registeredCol);
  const values = sheet.getRange(startRow, 1, rowCount, maxCol).getValues();

  const categoryIdx = layout.categoryCol - 1;
  const startTimeIdx = layout.startTimeCol - 1;
  const registeredIdx = layout.registeredCol - 1;

  let changed = false;
  const clearedEntries = [];
  const assignIndexes = [];

  // First pass: clear unregistered rows (frees slots for this same edit batch).
  for (let i = 0; i < rowCount; i++) {
    const registered = values[i][registeredIdx];
    const currentTime = values[i][startTimeIdx];
    const hasCurrentTime = currentTime !== '' && currentTime !== null;

    if (registered === false && hasCurrentTime) {
      const slot = getStartSlotFromCategory_(values[i][categoryIdx]);
      clearedEntries.push({ slot, time: currentTime });
      values[i][startTimeIdx] = '';
      changed = true;
      continue;
    }

    if (registered === true && !hasCurrentTime) {
      assignIndexes.push(i);
    }
  }

  if (assignIndexes.length > 0) {
    if (!runtime.timesBySlot || !runtime.usedBySlot) {
      const timesSheet = runtime.ss.getSheetByName(TIMES_SHEET_NAME_);
      if (!timesSheet) {
        throw new Error('List "Časy - nastavení" neexistuje.');
      }

      runtime.timesBySlot = getAllTimesBySlot_(timesSheet);
      runtime.usedBySlot = getUsedTimesBySlot_(runtime.ss, runtime.timezone);
      runtime.minAllowedMinutes = getNowMinutesInTimezone_(runtime.timezone) + MIN_START_OFFSET_MINUTES_;
    }

    // Release slots that were just cleared in this batch.
    clearedEntries.forEach((entry) => {
      if (!entry.slot || !runtime.usedBySlot[entry.slot]) return;
      const key = normalizeTimeKey_(entry.time, runtime.timezone);
      if (!key) return;
      runtime.usedBySlot[entry.slot].delete(key);
    });

    assignIndexes.forEach((idx) => {
      const slot = getStartSlotFromCategory_(values[idx][categoryIdx]);
      if (!slot) return;

      const firstFree = pickFirstFreeTimeForSlot_(
        slot,
        runtime.timesBySlot,
        runtime.usedBySlot,
        runtime.timezone,
        runtime.minAllowedMinutes,
      );

      if (firstFree === null) return;
      values[idx][startTimeIdx] = firstFree;
      changed = true;
    });
  }

  if (!changed) return false;

  const startTimeColumnValues = values.map((row) => [row[startTimeIdx]]);
  sheet.getRange(startRow, layout.startTimeCol, rowCount, 1).setValues(startTimeColumnValues);
  return true;
}

function priradCasProRadek_(sheet, row) {
  if (!sheet || row < DATA_START_ROW_) return;

  const lock = acquireDocumentLockOrThrow_();
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const runtime = {
      ss,
      timezone: getSpreadsheetTimezone_(),
      timesBySlot: null,
      usedBySlot: null,
      minAllowedMinutes: null,
    };
    processRegistrationRowsUnsafe_(sheet, row, 1, runtime);
  } finally {
    lock.releaseLock();
  }
}

function smazHodnotyProRadek_(sheet, row) {
  if (!sheet || row < DATA_START_ROW_) return;

  const lock = acquireDocumentLockOrThrow_();
  try {
    const layout = getSheetLayout_(sheet.getName());
    sheet.getRange(row, layout.startTimeCol).clearContent();
  } finally {
    lock.releaseLock();
  }
}

function priradVseProRadek_(sheet, row) {
  priradCasProRadek_(sheet, row);
}

function buildFullNameWithNick_(firstName, lastName, nick) {
  const first = String(firstName || '').trim();
  const last = String(lastName || '').trim();
  const nickname = String(nick || '').trim();

  const full = [first, last].filter(Boolean).join(' ');
  if (!full) return '';

  if (!nickname) return full;
  return `${full} (${nickname})`;
}

function buildChildWithTeam_(firstName, lastName, nick, teamName) {
  const fullName = buildFullNameWithNick_(firstName, lastName, nick);
  const team = String(teamName || '').trim();

  if (!fullName) return '';
  if (!team) return fullName;

  return `${fullName} - ${team}`;
}

function joinUniqueNonEmpty_(values, separator) {
  const seen = new Set();
  const out = [];

  values.forEach((v) => {
    const text = String(v || '').trim();
    if (!text) return;
    if (seen.has(text)) return;
    seen.add(text);
    out.push(text);
  });

  return out.join(separator || ', ');
}

function normalizeExportValue_(value, timezone) {
  if (value === '' || value === null) return '';
  if (isDateValue_(value)) {
    return Utilities.formatDate(value, timezone, 'HH:mm');
  }
  return String(value).trim();
}

function getLayoutMaxColumn_(layout) {
  return Math.max(
    layout.categoryCol,
    layout.patrolNoCol,
    layout.startTimeCol,
    layout.registeredCol,
    layout.child1FirstCol,
    layout.child1LastCol,
    layout.child1NickCol,
    layout.child2FirstCol,
    layout.child2LastCol,
    layout.child2NickCol,
    layout.child3FirstCol,
    layout.child3LastCol,
    layout.child3NickCol,
    layout.child1TeamCol || 0,
    layout.child2TeamCol || 0,
    layout.child3TeamCol || 0,
  );
}

function markExportSyncDirty_(source) {
  const dirtyAt = String(Date.now());
  const props = getSyncScriptProperties_();
  props.setProperty(EXPORT_SYNC_DIRTY_AT_PROP_, dirtyAt);
  if (source) {
    props.setProperty(EXPORT_SYNC_DIRTY_SOURCE_PROP_, String(source));
  } else {
    props.deleteProperty(EXPORT_SYNC_DIRTY_SOURCE_PROP_);
  }
  return dirtyAt;
}

function clearExportSyncDirtyIfMatches_(expectedDirtyAt) {
  const props = getSyncScriptProperties_();
  const currentDirtyAt = props.getProperty(EXPORT_SYNC_DIRTY_AT_PROP_);
  if (!currentDirtyAt) return false;
  if (expectedDirtyAt && currentDirtyAt !== String(expectedDirtyAt)) return false;
  props.deleteProperty(EXPORT_SYNC_DIRTY_AT_PROP_);
  props.deleteProperty(EXPORT_SYNC_DIRTY_SOURCE_PROP_);
  return true;
}

function getProjectTriggerById_(triggerId) {
  if (!triggerId) return null;
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    const trigger = triggers[i];
    if (trigger.getUniqueId && trigger.getUniqueId() === triggerId) {
      return trigger;
    }
  }
  return null;
}

function deleteProjectTriggerById_(triggerId) {
  if (!triggerId) return false;
  const trigger = getProjectTriggerById_(triggerId);
  if (!trigger) return false;
  ScriptApp.deleteTrigger(trigger);
  return true;
}

function ensureDebouncedExportTrigger_(delayMs) {
  if (!shouldQueueDebouncedExportSync_()) return '';

  const props = getSyncScriptProperties_();
  const existingId = props.getProperty(EXPORT_SYNC_DEBOUNCE_TRIGGER_ID_PROP_);
  if (existingId) {
    const existing = getProjectTriggerById_(existingId);
    if (existing) {
      return existingId;
    }
    props.deleteProperty(EXPORT_SYNC_DEBOUNCE_TRIGGER_ID_PROP_);
  }

  const runAt = new Date(Date.now() + Math.max(1000, Number(delayMs || EXPORT_DEBOUNCE_DELAY_MS_)));
  const trigger = ScriptApp.newTrigger(EXPORT_DEBOUNCE_HANDLER_).timeBased().at(runAt).create();
  const triggerId = trigger.getUniqueId();
  props.setProperty(EXPORT_SYNC_DEBOUNCE_TRIGGER_ID_PROP_, triggerId);
  return triggerId;
}

function scheduleDebouncedExportSync_(source) {
  if (!shouldQueueDebouncedExportSync_()) {
    return { dirtyAt: '', triggerId: '' };
  }

  const dirtyAt = markExportSyncDirty_(source);
  const props = getSyncScriptProperties_();
  const currentTriggerId = props.getProperty(EXPORT_SYNC_DEBOUNCE_TRIGGER_ID_PROP_);
  if (currentTriggerId) {
    deleteProjectTriggerById_(currentTriggerId);
    props.deleteProperty(EXPORT_SYNC_DEBOUNCE_TRIGGER_ID_PROP_);
  }

  const triggerId = ensureDebouncedExportTrigger_(EXPORT_DEBOUNCE_DELAY_MS_);
  return { dirtyAt, triggerId };
}

function clearStoredDebounceTriggerIdIfMatches_(expectedTriggerId) {
  const props = getSyncScriptProperties_();
  const currentTriggerId = props.getProperty(EXPORT_SYNC_DEBOUNCE_TRIGGER_ID_PROP_);
  if (!currentTriggerId) return false;
  if (expectedTriggerId && currentTriggerId !== String(expectedTriggerId)) return false;
  props.deleteProperty(EXPORT_SYNC_DEBOUNCE_TRIGGER_ID_PROP_);
  return true;
}

function cancelDebouncedExportTriggerIfMatches_(expectedTriggerId) {
  const props = getSyncScriptProperties_();
  const currentTriggerId = props.getProperty(EXPORT_SYNC_DEBOUNCE_TRIGGER_ID_PROP_);
  if (!currentTriggerId) return false;
  if (expectedTriggerId && currentTriggerId !== String(expectedTriggerId)) return false;
  deleteProjectTriggerById_(currentTriggerId);
  props.deleteProperty(EXPORT_SYNC_DEBOUNCE_TRIGGER_ID_PROP_);
  return true;
}

function syncRegisteredPatrolsToExportUnsafe_(ss, timezone) {
  let exportSheet = ss.getSheetByName(EXPORT_SHEET_NAME_);
  if (!exportSheet) {
    exportSheet = ss.insertSheet(EXPORT_SHEET_NAME_);
  }

  const headers = [
    'team_name',
    'patrol_code',
    'child1',
    'child2',
    'child3',
    'start_time',
    'note',
    'active',
  ];

  const output = [];

  getTargetSheetNames_().forEach((sheetName) => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;

    const lastRow = sheet.getLastRow();
    if (lastRow < DATA_START_ROW_) return;

    const layout = getSheetLayout_(sheetName);
    const maxCol = getLayoutMaxColumn_(layout);
    const rowCount = lastRow - DATA_START_ROW_ + 1;
    const values = sheet.getRange(DATA_START_ROW_, 1, rowCount, maxCol).getValues();

    values.forEach((row) => {
      const registered = row[layout.registeredCol - 1];
      if (!isRegistered_(registered)) return;

      const child1First = row[layout.child1FirstCol - 1];
      const child1Last = row[layout.child1LastCol - 1];
      const child1Nick = row[layout.child1NickCol - 1];

      const child2First = row[layout.child2FirstCol - 1];
      const child2Last = row[layout.child2LastCol - 1];
      const child2Nick = row[layout.child2NickCol - 1];

      const child3First = row[layout.child3FirstCol - 1];
      const child3Last = row[layout.child3LastCol - 1];
      const child3Nick = row[layout.child3NickCol - 1];

      const child1Team = layout.child1TeamCol ? row[layout.child1TeamCol - 1] : '';
      const child2Team = layout.child2TeamCol ? row[layout.child2TeamCol - 1] : '';
      const child3Team = layout.child3TeamCol ? row[layout.child3TeamCol - 1] : '';

      const category = row[layout.categoryCol - 1];
      const patrolNo = row[layout.patrolNoCol - 1];
      const startTime = row[layout.startTimeCol - 1];

      const patrolCode = `${String(category || '').trim()}-${String(patrolNo || '').trim()}`;

      let teamName;
      let child1;
      let child2;
      let child3;

      if (sheetName === 'Smíšené hlídky') {
        teamName = joinUniqueNonEmpty_([child1Team, child2Team, child3Team], ', ');
        child1 = buildChildWithTeam_(child1First, child1Last, child1Nick, child1Team);
        child2 = buildChildWithTeam_(child2First, child2Last, child2Nick, child2Team);
        child3 = buildChildWithTeam_(child3First, child3Last, child3Nick, child3Team);
      } else {
        teamName = sheetName;
        child1 = buildFullNameWithNick_(child1First, child1Last, child1Nick);
        child2 = buildFullNameWithNick_(child2First, child2Last, child2Nick);
        child3 = buildFullNameWithNick_(child3First, child3Last, child3Nick);
      }

      output.push([
        teamName,
        patrolCode,
        child1,
        child2,
        child3,
        normalizeExportValue_(startTime, timezone),
        '',
        'Yes',
      ]);
    });
  });

  const payload = [headers].concat(output);
  const targetRows = payload.length;
  const targetCols = headers.length;
  const currentRows = Math.max(exportSheet.getLastRow(), targetRows);

  if (currentRows > 0) {
    exportSheet.getRange(1, 1, currentRows, targetCols).clearContent();
  }
  exportSheet.getRange(1, 1, targetRows, targetCols).setValues(payload);
}

function syncRegisteredPatrolsToExport() {
  const lock = acquireDocumentLockOrThrow_();

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const timezone = getSpreadsheetTimezone_();
    syncRegisteredPatrolsToExportUnsafe_(ss, timezone);
    clearExportSyncDirtyIfMatches_();
  } finally {
    lock.releaseLock();
  }
}

function runDebouncedExportSync_(e) {
  if (!shouldQueueDebouncedExportSync_()) return;

  const triggerId = e && e.triggerUid ? String(e.triggerUid) : '';
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS_)) {
    try {
      scheduleDebouncedExportSync_('debounce_lock_retry');
    } catch (err) {
      console.warn(`Debounced export reschedule failed: ${err && err.message ? err.message : err}`);
    }
    return;
  }

  try {
    clearStoredDebounceTriggerIdIfMatches_(triggerId);

    const props = getSyncScriptProperties_();
    const dirtyAt = props.getProperty(EXPORT_SYNC_DIRTY_AT_PROP_);
    if (!dirtyAt) return;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const timezone = getSpreadsheetTimezone_();
    syncRegisteredPatrolsToExportUnsafe_(ss, timezone);

    const cleared = clearExportSyncDirtyIfMatches_(dirtyAt);
    if (!cleared) {
      ensureDebouncedExportTrigger_(EXPORT_DEBOUNCE_DELAY_MS_);
    }
  } finally {
    lock.releaseLock();
  }
}

function onEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  const sheetName = sheet.getName();
  if (!TARGET_SHEET_NAME_SET_[sheetName]) return;

  const editStartRow = e.range.getRow();
  const editEndRow = e.range.getLastRow();
  if (editEndRow < DATA_START_ROW_) return;

  let scheduledSync = { dirtyAt: '', triggerId: '' };
  if (shouldQueueDebouncedExportSync_()) {
    try {
      scheduledSync = scheduleDebouncedExportSync_('on_edit');
    } catch (err) {
      // Running from simple triggers without auth can block trigger management.
      console.warn(`Debounced export scheduling failed: ${err && err.message ? err.message : err}`);
    }
  }

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS_)) {
    return;
  }

  try {
    const layout = getSheetLayout_(sheetName);
    const editStartCol = e.range.getColumn();
    const editEndCol = e.range.getLastColumn();
    const touchesRegistrationCol =
      editStartCol <= layout.registeredCol && editEndCol >= layout.registeredCol;

    const runtime = {
      ss: SpreadsheetApp.getActiveSpreadsheet(),
      timezone: getSpreadsheetTimezone_(),
      timesBySlot: null,
      usedBySlot: null,
      minAllowedMinutes: null,
    };

    if (touchesRegistrationCol) {
      const startRow = Math.max(DATA_START_ROW_, editStartRow);
      const rowCount = editEndRow - startRow + 1;
      if (rowCount > 0) {
        processRegistrationRowsUnsafe_(sheet, startRow, rowCount, runtime);
      }
    }

    if (shouldRunImmediateExportSync_()) {
      syncRegisteredPatrolsToExportUnsafe_(runtime.ss, runtime.timezone);

      if (scheduledSync.dirtyAt) {
        const cleared = clearExportSyncDirtyIfMatches_(scheduledSync.dirtyAt);
        if (cleared) {
          cancelDebouncedExportTriggerIfMatches_(scheduledSync.triggerId);
        }
      }
    }
  } finally {
    lock.releaseLock();
  }
}
