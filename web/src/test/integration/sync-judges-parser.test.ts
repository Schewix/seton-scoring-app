import { describe, expect, it } from 'vitest';
import {
  buildBoardAssignmentsFromRows,
  normalizeLookupKey,
  parseBoardCsvRows,
  parseJudgeCsvRows,
} from '../../../../supabase/functions/sync-judges/parser.ts';

describe('sync-judges parser integration', () => {
  it('parses deskovka with multiple games and allowed categories V,VI', () => {
    const rows = [
      ['deskovka', 'jmeno', 'prijmeni', 'email', 'telefon', 'allowed_categories'],
      ['kriskros, dominion', 'Ondřej', 'Ševčík', 'osevcik@severka.org', '', 'V,VI'],
    ];

    const parsed = parseBoardCsvRows(rows);
    expect(parsed).toHaveLength(4);

    const keys = parsed.map((row) => `${row.gameNameKey}|${row.categoryNameRaw}`).sort();
    expect(keys).toEqual([
      'dominion|V',
      'dominion|VI',
      'kris kros|V',
      'kris kros|VI',
    ]);
    expect(parsed.every((row) => row.email === 'osevcik@severka.org')).toBe(true);
  });

  it('accepts header "deskové hry" as game column', () => {
    const rows = [
      ['deskové hry', 'jmeno', 'prijmeni', 'email', 'telefon', 'allowed_categories'],
      ['kriskros, dominion', 'Ondřej', 'Ševčík', 'osevcik@severka.org', '', 'V,VI'],
    ];

    const parsed = parseBoardCsvRows(rows);
    expect(parsed).toHaveLength(4);
    expect(new Set(parsed.map((row) => row.gameNameKey))).toEqual(new Set(['kris kros', 'dominion']));
  });

  it('deduplicates board assignments and maps games/categories to board_judge_assignment keys', () => {
    const parsedRows = parseBoardCsvRows([
      ['deskovka', 'jmeno', 'prijmeni', 'email', 'allowed_categories'],
      ['dominion, kriskros', 'Martin', 'Šmíd', 'ondra1792@gmail.com', 'V,VI'],
      ['kriskros, dominion', 'Martin', 'Šmíd', 'ondra1792@gmail.com', 'V,VI'],
    ]);

    const result = buildBoardAssignmentsFromRows({
      rows: parsedRows,
      judgeIdByEmail: new Map([['ondra1792@gmail.com', 'judge-1']]),
      gameIdByKey: new Map([
        ['dominion', 'game-dominion'],
        ['kris kros', 'game-kris-kros'],
      ]),
      categoryIdByKey: new Map([
        [normalizeLookupKey('V'), 'cat-v'],
        [normalizeLookupKey('VI'), 'cat-vi'],
      ]),
    });

    expect(result.errors).toEqual([]);
    expect(result.assignments).toHaveLength(4);
    expect(result.skippedDuplicates.length).toBeGreaterThan(0);
    expect(
      new Set(
        result.assignments.map((assignment) =>
          `${assignment.judgeId}|${assignment.gameId}|${assignment.categoryId ?? ''}`,
        ),
      ).size,
    ).toBe(result.assignments.length);
  });

  it('reports unknown categories and unknown games as errors', () => {
    const parsedRows = parseBoardCsvRows([
      ['deskovka', 'email', 'allowed_categories'],
      ['neznama-hra', 'judge@example.com', 'V,VI'],
      ['kriskros', 'judge@example.com', 'X'],
    ]);

    const result = buildBoardAssignmentsFromRows({
      rows: parsedRows,
      judgeIdByEmail: new Map([['judge@example.com', 'judge-1']]),
      gameIdByKey: new Map([['kris kros', 'game-kris-kros']]),
      categoryIdByKey: new Map([
        [normalizeLookupKey('V'), 'cat-v'],
        [normalizeLookupKey('VI'), 'cat-vi'],
      ]),
    });

    expect(result.assignments).toEqual([]);
    expect(result.errors.some((error) => error.includes('Unknown board game'))).toBe(true);
    expect(result.errors.some((error) => error.includes('Unknown board category'))).toBe(true);
  });

  it('parses classic judge CSV allowed categories and keeps them deduplicated/sorted', () => {
    const parsed = parseJudgeCsvRows([
      ['stanoviste', 'jmeno', 'prijmeni', 'email', 'allowed_categories'],
      ['K', 'Rozhodčí', 'Test', 'judge@test.cz', 'S, N, S, M'],
    ]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].allowedCategories).toEqual(['M', 'N', 'S']);
    expect(parsed[0].stationCode).toBe('K');
  });
});
