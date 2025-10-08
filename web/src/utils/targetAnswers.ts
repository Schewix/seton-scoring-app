export const ANSWER_CATEGORIES = ['N', 'M', 'S', 'R'] as const;
export type CategoryKey = (typeof ANSWER_CATEGORIES)[number];

export function isCategoryKey(value: string): value is CategoryKey {
  return (ANSWER_CATEGORIES as readonly string[]).includes(value);
}

export function parseAnswerLetters(value = '') {
  return (value.match(/[A-D]/gi) || []).map((letter) => letter.toUpperCase());
}

export function formatAnswersForInput(stored = '') {
  return parseAnswerLetters(stored).join(' ');
}

export function packAnswersForStorage(value = '') {
  return parseAnswerLetters(value).join('');
}
