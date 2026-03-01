export const VALID_CATEGORIES = ['N', 'M', 'S', 'R'] as const;
const CATEGORY_SET = new Set<string>(VALID_CATEGORIES);

export type JudgeRow = {
  stationCode: string;
  displayName: string;
  email: string;
  phone: string | null;
  allowedCategories: string[];
};

export type BoardJudgeRow = {
  gameNameRaw: string;
  gameNameKey: string;
  categoryNameRaw: string | null;
  displayName: string;
  email: string;
  phone: string | null;
};

export type BoardAssignmentCandidate = {
  judgeId: string;
  email: string;
  gameId: string;
  categoryId: string | null;
  gameNameRaw: string;
  categoryNameRaw: string | null;
};

export type BuildBoardAssignmentsResult = {
  assignments: BoardAssignmentCandidate[];
  skippedDuplicates: string[];
  errors: string[];
};

export const BOARD_GAME_ALIASES: Record<string, string> = {
  kriskros: 'kris kros',
  kriskrosy: 'kris kros',
  kris: 'kris kros',
  tvc: 'tajna vyprava carodeju',
  tajnavyprava: 'tajna vyprava carodeju',
  tajnavypravacarodeju: 'tajna vyprava carodeju',
  hop: 'hop',
  'milostny dopis': 'dominion',
  milostnydopis: 'dominion',
  loveletter: 'dominion',
};

const ROMAN_CATEGORY_RE = /^(I|II|III|IV|V|VI)$/i;

function buildDisplayName(firstName: string, lastName: string): string {
  const parts = [firstName.trim(), lastName.trim()].filter(Boolean);
  return parts.join(' ');
}

function normalizeCell(value: string | undefined): string {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

export function normalizeHeaderKey(column: string): string {
  return column
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function normalizeLookupKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeBoardGameKey(value: string): string {
  const key = normalizeLookupKey(value);
  return BOARD_GAME_ALIASES[key] ?? key;
}

export function parseAllowedCategories(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  const parts = raw
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean)
    .filter((part) => CATEGORY_SET.has(part));
  const unique = Array.from(new Set(parts));
  unique.sort();
  return unique;
}

export function parseMultiValueCell(raw: string): string[] {
  if (!raw) {
    return [];
  }

  const seen = new Set<string>();
  const values: string[] = [];
  for (const part of raw.split(/[;,]+/)) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const dedupKey = normalizeLookupKey(trimmed);
    if (!dedupKey || seen.has(dedupKey)) {
      continue;
    }
    seen.add(dedupKey);
    values.push(trimmed);
  }
  return values;
}

export function extractRomanCategoryToken(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  if (ROMAN_CATEGORY_RE.test(normalized)) {
    return normalized;
  }
  const match = normalized.match(/\b(VI|IV|V|III|II|I)\b/);
  return match?.[1] ?? null;
}

export function findHeaderIndex(normalizedHeader: string[], ...candidates: string[]): number {
  const normalizedCandidates = candidates
    .map((candidate) => normalizeHeaderKey(candidate))
    .filter((candidate) => candidate.length > 0);

  for (const candidate of normalizedCandidates) {
    const exactIdx = normalizedHeader.indexOf(candidate);
    if (exactIdx !== -1) {
      return exactIdx;
    }
  }

  // Fallback for sheets where first data token leaked into header, e.g. "stanoviste_A".
  for (const candidate of normalizedCandidates) {
    const looseIdx = normalizedHeader.findIndex(
      (column) => column.startsWith(`${candidate}_`) || column.endsWith(`_${candidate}`),
    );
    if (looseIdx !== -1) {
      return looseIdx;
    }
  }

  return -1;
}

export function parseJudgeCsvRows(rows: string[][]): JudgeRow[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const [header, ...dataRows] = rows;
  const normalizedHeader = header.map((column) => normalizeHeaderKey(column));

  const idxStation = findHeaderIndex(normalizedHeader, 'stanoviste', 'stanoviště', 'station', 'station_code');
  const idxFirst = findHeaderIndex(normalizedHeader, 'jmeno', 'jméno', 'first_name');
  const idxLast = findHeaderIndex(normalizedHeader, 'prijmeni', 'příjmení', 'last_name');
  const idxEmail = findHeaderIndex(normalizedHeader, 'email', 'e-mail');
  const idxPhone = findHeaderIndex(normalizedHeader, 'telefon', 'phone');
  const idxCategories = findHeaderIndex(normalizedHeader, 'allowed_categories', 'allowed categories', 'categories');

  if (idxStation === -1 || idxFirst === -1 || idxEmail === -1) {
    throw new Error('Sheet must contain columns "stanoviste", "jmeno", "email".');
  }

  const result: JudgeRow[] = [];

  for (const row of dataRows) {
    if (!row || row.length === 0 || row.every((cell) => !cell || !cell.trim())) {
      continue;
    }

    const stationCode = normalizeCell(row[idxStation]).toUpperCase();
    const firstName = normalizeCell(row[idxFirst]);
    const lastName = idxLast !== -1 ? normalizeCell(row[idxLast]) : '';
    const email = normalizeCell(row[idxEmail]).toLowerCase();
    const phone = idxPhone !== -1 ? normalizeCell(row[idxPhone]) : '';
    const categoriesRaw = idxCategories !== -1 ? normalizeCell(row[idxCategories]) : '';

    if (!stationCode || !email || !firstName) {
      continue;
    }

    result.push({
      stationCode,
      displayName: buildDisplayName(firstName, lastName),
      email,
      phone: phone || null,
      allowedCategories: parseAllowedCategories(categoriesRaw),
    });
  }

  return result;
}

export function parseBoardCsvRows(rows: string[][]): BoardJudgeRow[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const [header, ...dataRows] = rows;
  const normalizedHeader = header.map((column) => normalizeHeaderKey(column));

  const idxGame = findHeaderIndex(normalizedHeader, 'deskovka', 'hra', 'game', 'board_game');
  const idxFirst = findHeaderIndex(normalizedHeader, 'jmeno', 'jméno', 'first_name');
  const idxLast = findHeaderIndex(normalizedHeader, 'prijmeni', 'příjmení', 'last_name');
  const idxEmail = findHeaderIndex(normalizedHeader, 'email', 'e-mail');
  const idxPhone = findHeaderIndex(normalizedHeader, 'telefon', 'phone');
  const idxAllowedCategories = findHeaderIndex(
    normalizedHeader,
    'allowed_categories',
    'allowed categories',
    'allowedcategories',
    'allowed_category',
  );
  const idxCategory = findHeaderIndex(normalizedHeader, 'kategorie', 'category');

  if (idxGame === -1 || idxEmail === -1) {
    throw new Error('Board sheet must contain columns "deskovka" and "email".');
  }

  const result: BoardJudgeRow[] = [];

  for (const row of dataRows) {
    if (!row || row.length === 0 || row.every((cell) => !cell || !cell.trim())) {
      continue;
    }

    const gameNameRaw = normalizeCell(row[idxGame]);
    const firstName = idxFirst !== -1 ? normalizeCell(row[idxFirst]) : '';
    const lastName = idxLast !== -1 ? normalizeCell(row[idxLast]) : '';
    const email = normalizeCell(row[idxEmail]).toLowerCase();
    const phone = idxPhone !== -1 ? normalizeCell(row[idxPhone]) : '';
    const categoryNameRaw = idxCategory !== -1 ? normalizeCell(row[idxCategory]) : '';
    const allowedCategoriesRaw = idxAllowedCategories !== -1 ? normalizeCell(row[idxAllowedCategories]) : '';
    const displayName = buildDisplayName(firstName, lastName) || email;

    if (!gameNameRaw || !email) {
      continue;
    }

    const gameNames = parseMultiValueCell(gameNameRaw);
    if (!gameNames.length) {
      continue;
    }

    const categoryValues = parseMultiValueCell(allowedCategoriesRaw || categoryNameRaw);
    const categories = categoryValues.length ? categoryValues : [null];

    for (const gameName of gameNames) {
      for (const category of categories) {
        result.push({
          gameNameRaw: gameName,
          gameNameKey: normalizeBoardGameKey(gameName),
          categoryNameRaw: category,
          displayName,
          email,
          phone: phone || null,
        });
      }
    }
  }

  return result;
}

export function buildBoardAssignmentsFromRows(params: {
  rows: BoardJudgeRow[];
  judgeIdByEmail: Map<string, string>;
  gameIdByKey: Map<string, string>;
  categoryIdByKey: Map<string, string>;
}): BuildBoardAssignmentsResult {
  const { rows, judgeIdByEmail, gameIdByKey, categoryIdByKey } = params;
  const assignments: BoardAssignmentCandidate[] = [];
  const skippedDuplicates: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const judgeId = judgeIdByEmail.get(row.email);
    if (!judgeId) {
      errors.push(`Unknown judge "${row.email}" for board assignment`);
      continue;
    }

    const gameId = gameIdByKey.get(row.gameNameKey);
    if (!gameId) {
      errors.push(`Unknown board game "${row.gameNameRaw}" for ${row.email}`);
      continue;
    }

    let categoryId: string | null = null;
    if (row.categoryNameRaw) {
      categoryId = categoryIdByKey.get(normalizeLookupKey(row.categoryNameRaw)) ?? null;
      if (!categoryId) {
        errors.push(`Unknown board category "${row.categoryNameRaw}" for ${row.email}`);
        continue;
      }
    }

    const dedupKey = `${judgeId}|${gameId}|${categoryId ?? ''}`;
    if (seen.has(dedupKey)) {
      skippedDuplicates.push(`Duplicate board assignment skipped for ${row.email} (${row.gameNameRaw})`);
      continue;
    }

    seen.add(dedupKey);
    assignments.push({
      judgeId,
      email: row.email,
      gameId,
      categoryId,
      gameNameRaw: row.gameNameRaw,
      categoryNameRaw: row.categoryNameRaw,
    });
  }

  return {
    assignments,
    skippedDuplicates,
    errors,
  };
}
