export const ANSWER_CATEGORIES = ['N', 'M', 'S', 'R'] as const;
export type CategoryKey = (typeof ANSWER_CATEGORIES)[number];
export type TargetAnswerOptionCount = 3 | 4;

type ParseAnswerOptions = {
  maxOptionCount?: TargetAnswerOptionCount;
  allowBlank?: boolean;
};

export function isCategoryKey(value: string): value is CategoryKey {
  return (ANSWER_CATEGORIES as readonly string[]).includes(value);
}

function toMaxOptionCount(value: unknown): TargetAnswerOptionCount {
  return value === 3 ? 3 : 4;
}

function buildParsePattern(options?: ParseAnswerOptions) {
  const maxOptionCount = toMaxOptionCount(options?.maxOptionCount);
  const allowBlank = options?.allowBlank === true;
  if (maxOptionCount === 3) {
    return allowBlank ? /[A-CX]/gi : /[A-C]/gi;
  }
  return allowBlank ? /[A-DX]/gi : /[A-D]/gi;
}

export function parseAnswerLetters(value = '', options?: ParseAnswerOptions) {
  return (value.match(buildParsePattern(options)) || []).map((letter) => letter.toUpperCase());
}

export function normalizeAnswersInput(value = '', options?: ParseAnswerOptions) {
  return parseAnswerLetters(value, options).join('');
}

export function formatAnswersForInput(stored = '', options?: ParseAnswerOptions) {
  return parseAnswerLetters(stored, options).join(' ');
}

export function packAnswersForStorage(value = '', options?: ParseAnswerOptions) {
  return normalizeAnswersInput(value, options);
}
