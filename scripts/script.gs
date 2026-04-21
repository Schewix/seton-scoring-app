function getTargetSheetNames_() {
  return [
    "2. PTO Poutníci",
    "6. PTO Nibowaka",
    "10. PTO Severka",
    "11. PTO Iktómi",
    "14.TSP Zeměpisná společnost \"PCV\"",
    "21. PTO Hády",
    "32. PTO Severka",
    "34. PTO Tulák",
    "48. PTO Stezka",
    "63. PTO Phoenix",
    "64. PTO Lorien",
    "66. PTO Brabrouci",
    "99. PTO Kamzíci",
    "111. PTO Vinohrady",
    "176. PTO Vlčata",
    "Duha Expedice",
    "Žabky Jedovnice",
    "Smíšené hlídky",
    "Template Účastníci"
  ];
}

const MIN_TEAM_START_GAP_MINUTES_ = 6;

function normalizeValue_(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function isRegistered_(value) {
  return value === true;
}

function getSpreadsheetTimezone_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || "Europe/Prague";
}

function normalizeTimeKey_(value, timezone) {
  if (value === "" || value === null) return "";
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value)) {
    return Utilities.formatDate(value, timezone, "HH:mm");
  }
  return String(value).trim();
}

function timeToMinutes_(value, timezone) {
  const key = normalizeTimeKey_(value, timezone);
  const match = key.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function getStartSlotFromCategory_(category) {
  const c = normalizeValue_(category);

  if (c === "NH" || c === "ND") return "N";
  if (c === "MH") return "MH";
  if (c === "MD") return "MD";
  if (c === "SH") return "SH";
  if (c === "SD") return "SD";
  if (c === "RH" || c === "RD") return "R";

  return "";
}

function getAllTimesForSlot_(timesSheet, slot) {
  let range = null;

  if (slot === "N") range = timesSheet.getRange("A2:A");
  if (slot === "MH") range = timesSheet.getRange("B2:B");
  if (slot === "MD") range = timesSheet.getRange("C2:C");
  if (slot === "SH") range = timesSheet.getRange("D2:D");
  if (slot === "SD") range = timesSheet.getRange("E2:E");
  if (slot === "R") range = timesSheet.getRange("F2:F");

  if (!range) return [];
  return range.getValues().flat().filter(v => v !== "" && v !== null);
}

function getFreeTimesSheet_(ss) {
  const candidateNames = ["Volne casy", "Volné časy", "Časy - nastavení"];
  for (let i = 0; i < candidateNames.length; i++) {
    const sheet = ss.getSheetByName(candidateNames[i]);
    if (sheet) return sheet;
  }
  throw new Error('List "Volne casy" neexistuje.');
}

function normalizeTeamKey_(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function getOddilKeysForRowValues_(sheetName, layout, rowValues) {
  const keys = [];

  if (sheetName === "Smíšené hlídky") {
    const teamCols = [layout.child1TeamCol, layout.child2TeamCol, layout.child3TeamCol].filter(Boolean);
    teamCols.forEach(col => {
      const key = normalizeTeamKey_(rowValues[col - 1]);
      if (key) keys.push(key);
    });
  } else {
    const key = normalizeTeamKey_(sheetName);
    if (key) keys.push(key);
  }

  return [...new Set(keys)];
}

function getOddilKeysForCurrentRow_(sheet, row, layout) {
  const sheetName = sheet.getName();
  const maxTeamCol = Math.max(layout.child1TeamCol || 0, layout.child2TeamCol || 0, layout.child3TeamCol || 0);
  if (maxTeamCol <= 0) {
    return getOddilKeysForRowValues_(sheetName, layout, []);
  }

  const rowValues = sheet.getRange(row, 1, 1, maxTeamCol).getValues()[0];
  return getOddilKeysForRowValues_(sheetName, layout, rowValues);
}

function getUsedStartMinutesByOddil_(ss, timezone) {
  const usedByOddil = {};

  getTargetSheetNames_().forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;

    const lastRow = sheet.getLastRow();
    if (lastRow < 4) return;

    const layout = getSheetLayout_(sheetName);
    const rowCount = lastRow - 3;
    const maxCol = Math.max(
      layout.startTimeCol,
      layout.child1TeamCol || 0,
      layout.child2TeamCol || 0,
      layout.child3TeamCol || 0
    );
    const values = sheet.getRange(4, 1, rowCount, maxCol).getValues();

    values.forEach(row => {
      const startMinutes = timeToMinutes_(row[layout.startTimeCol - 1], timezone);
      if (startMinutes === null) return;

      const oddilKeys = getOddilKeysForRowValues_(sheetName, layout, row);
      oddilKeys.forEach(key => {
        if (!usedByOddil[key]) usedByOddil[key] = [];
        usedByOddil[key].push(startMinutes);
      });
    });
  });

  return usedByOddil;
}

function hasOddilStartConflict_(oddilKeys, candidateMinutes, usedByOddil) {
  for (let i = 0; i < oddilKeys.length; i++) {
    const key = oddilKeys[i];
    const usedTimes = usedByOddil[key] || [];
    for (let j = 0; j < usedTimes.length; j++) {
      if (Math.abs(usedTimes[j] - candidateMinutes) < MIN_TEAM_START_GAP_MINUTES_) {
        return true;
      }
    }
  }
  return false;
}

function getSheetLayout_(sheetName) {
  // default = klasické listy
  const layout = {
    categoryCol: 17,      // Q
    patrolNoCol: 19,      // S
    startTimeCol: 22,     // V
    registeredCol: 23,    // W

    child1TeamCol: null,
    child1FirstCol: 2,    // B
    child1LastCol: 3,     // C
    child1NickCol: 4,     // D

    child2TeamCol: null,
    child2FirstCol: 7,    // G
    child2LastCol: 8,     // H
    child2NickCol: 9,     // I

    child3TeamCol: null,
    child3FirstCol: 12,   // L
    child3LastCol: 13,    // M
    child3NickCol: 14     // N
  };

  if (sheetName === "Smíšené hlídky") {
    return {
      categoryCol: 20,      // T
      patrolNoCol: 22,      // V
      startTimeCol: 25,     // Y
      registeredCol: 26,    // Z

      child1TeamCol: 2,     // B
      child1FirstCol: 3,    // C
      child1LastCol: 4,     // D
      child1NickCol: 5,     // E

      child2TeamCol: 8,     // H
      child2FirstCol: 9,    // I
      child2LastCol: 10,    // J
      child2NickCol: 11,    // K

      child3TeamCol: 14,    // N
      child3FirstCol: 15,   // O
      child3LastCol: 16,    // P
      child3NickCol: 17     // Q
    };
  }

  return layout;
}

function getUsedTimesBySlot_(ss, timezone) {
  const usedBySlot = {
    N: new Set(),
    MH: new Set(),
    MD: new Set(),
    SH: new Set(),
    SD: new Set(),
    R: new Set()
  };

  getTargetSheetNames_().forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;

    const lastRow = sheet.getLastRow();
    if (lastRow < 4) return;

    const layout = getSheetLayout_(sheetName);
    const rowCount = lastRow - 3;

    const timeValues = sheet.getRange(4, layout.startTimeCol, rowCount, 1).getValues();
    const categoryValues = sheet.getRange(4, layout.categoryCol, rowCount, 1).getValues();

    for (let i = 0; i < rowCount; i++) {
      const startTime = timeValues[i][0];
      const category = categoryValues[i][0];

      const slot = getStartSlotFromCategory_(category);
      if (!slot) continue;

      const timeKey = normalizeTimeKey_(startTime, timezone);
      if (!timeKey) continue;

      usedBySlot[slot].add(timeKey);
    }
  });

  return usedBySlot;
}

function nowInTimezoneMs_(timezone) {
  const now = new Date();
  const datePart = Utilities.formatDate(now, timezone, "yyyy-MM-dd");
  const timePart = Utilities.formatDate(now, timezone, "HH:mm:ss");
  return new Date(`${datePart}T${timePart}`).getTime();
}

function timeTodayMs_(value, timezone) {
  if (value === "" || value === null) return null;

  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value)) {
    const today = new Date();
    const datePart = Utilities.formatDate(today, timezone, "yyyy-MM-dd");
    const timePart = Utilities.formatDate(value, timezone, "HH:mm:ss");
    return new Date(`${datePart}T${timePart}`).getTime();
  }

  const text = String(value).trim();
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const today = new Date();
  const datePart = Utilities.formatDate(today, timezone, "yyyy-MM-dd");
  const hh = match[1].padStart(2, "0");
  const mm = match[2];
  return new Date(`${datePart}T${hh}:${mm}:00`).getTime();
}

function priradCasProRadek_(sheet, row) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const timesSheet = getFreeTimesSheet_(ss);

  const timezone = getSpreadsheetTimezone_();
  const layout = getSheetLayout_(sheet.getName());

  const registered = sheet.getRange(row, layout.registeredCol).getValue();
  const currentTime = sheet.getRange(row, layout.startTimeCol).getValue();
  const category = sheet.getRange(row, layout.categoryCol).getValue();

  if (!isRegistered_(registered)) return;
  if (currentTime !== "" && currentTime !== null) return;

  const slot = getStartSlotFromCategory_(category);
  if (!slot) return;

  const allTimes = getAllTimesForSlot_(timesSheet, slot);
  const oddilKeys = getOddilKeysForCurrentRow_(sheet, row, layout);
  const usedByOddil = getUsedStartMinutesByOddil_(ss, timezone);
  const minAllowedMs = nowInTimezoneMs_(timezone) + 20 * 60 * 1000;

  const firstFree = allTimes.find(t => {
    const key = normalizeTimeKey_(t, timezone);
    if (!key) return false;

    const candidateMs = timeTodayMs_(t, timezone);
    if (candidateMs === null) return false;
    if (candidateMs < minAllowedMs) return false;

    const candidateMinutes = timeToMinutes_(t, timezone);
    if (candidateMinutes === null) return false;
    if (hasOddilStartConflict_(oddilKeys, candidateMinutes, usedByOddil)) return false;

    return true;
  });

  if (firstFree) {
    sheet.getRange(row, layout.startTimeCol).setValue(firstFree);
  }
}

function smazHodnotyProRadek_(sheet, row) {
  const layout = getSheetLayout_(sheet.getName());
  sheet.getRange(row, layout.startTimeCol).clearContent();
}

function priradVseProRadek_(sheet, row) {
  priradCasProRadek_(sheet, row);
}

function buildFullNameWithNick_(firstName, lastName, nick) {
  const first = String(firstName || "").trim();
  const last = String(lastName || "").trim();
  const nickname = String(nick || "").trim();

  const full = [first, last].filter(Boolean).join(" ");
  if (!full) return "";

  if (!nickname) return full;
  return `${full} (${nickname})`;
}

function buildChildWithTeam_(firstName, lastName, nick, teamName) {
  const fullName = buildFullNameWithNick_(firstName, lastName, nick);
  const team = String(teamName || "").trim();

  if (!fullName) return "";
  if (!team) return fullName;

  return `${fullName} - ${team}`;
}

function joinUniqueNonEmpty_(values, separator) {
  const seen = new Set();
  const out = [];

  values.forEach(v => {
    const text = String(v || "").trim();
    if (!text) return;
    if (seen.has(text)) return;
    seen.add(text);
    out.push(text);
  });

  return out.join(separator || ", ");
}

function normalizeExportValue_(value, timezone) {
  if (value === "" || value === null) return "";
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value)) {
    return Utilities.formatDate(value, timezone, "HH:mm");
  }
  return String(value).trim();
}

function syncRegisteredPatrolsToExport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const timezone = ss.getSpreadsheetTimeZone() || "Europe/Prague";
  const exportSheetName = "Všechny hlídky";

  let exportSheet = ss.getSheetByName(exportSheetName);
  if (!exportSheet) {
    exportSheet = ss.insertSheet(exportSheetName);
  }

  const headers = [
    "team_name",
    "patrol_code",
    "child1",
    "child2",
    "child3",
    "start_time",
    "note",
    "active"
  ];

  const output = [];

  getTargetSheetNames_().forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;

    const lastRow = sheet.getLastRow();
    if (lastRow < 4) return;

    const layout = getSheetLayout_(sheetName);

    const maxCol = Math.max(
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
      layout.child3TeamCol || 0
    );

    const values = sheet.getRange(4, 1, lastRow - 3, maxCol).getValues();

    values.forEach(row => {
      const child1First = row[layout.child1FirstCol - 1];
      const child1Last  = row[layout.child1LastCol - 1];
      const child1Nick  = row[layout.child1NickCol - 1];

      const child2First = row[layout.child2FirstCol - 1];
      const child2Last  = row[layout.child2LastCol - 1];
      const child2Nick  = row[layout.child2NickCol - 1];

      const child3First = row[layout.child3FirstCol - 1];
      const child3Last  = row[layout.child3LastCol - 1];
      const child3Nick  = row[layout.child3NickCol - 1];

      const child1Team  = layout.child1TeamCol ? row[layout.child1TeamCol - 1] : "";
      const child2Team  = layout.child2TeamCol ? row[layout.child2TeamCol - 1] : "";
      const child3Team  = layout.child3TeamCol ? row[layout.child3TeamCol - 1] : "";

      const category    = row[layout.categoryCol - 1];
      const patrolNo    = row[layout.patrolNoCol - 1];
      const startTime   = row[layout.startTimeCol - 1];
      const registered  = row[layout.registeredCol - 1];

      if (registered !== true) return;

      const patrolCode = `${String(category || "").trim()}-${String(patrolNo || "").trim()}`;

      let teamName;
      let child1;
      let child2;
      let child3;

      if (sheetName === "Smíšené hlídky") {
        teamName = joinUniqueNonEmpty_([child1Team, child2Team, child3Team], ", ");
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
        "",
        "Yes"
      ]);
    });
  });

  exportSheet.clearContents();
  exportSheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (output.length > 0) {
    exportSheet.getRange(2, 1, output.length, headers.length).setValues(output);
  }
}

function onEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  const sheetName = sheet.getName();
  const row = e.range.getRow();
  const col = e.range.getColumn();

  if (!getTargetSheetNames_().includes(sheetName)) return;
  if (row < 4) return;

  const layout = getSheetLayout_(sheetName);
  if (col !== layout.registeredCol) return;

  const newValue = e.range.getValue();

  if (newValue === true) {
    priradVseProRadek_(sheet, row);
    SpreadsheetApp.flush();
  } else if (newValue === false) {
    smazHodnotyProRadek_(sheet, row);
    SpreadsheetApp.flush();
  }
}
