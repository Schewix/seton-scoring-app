import { useCallback, useId, useMemo } from 'react';

const PATROL_CODE_REGEX = /^[NMSR][HD]-(?:[1-9]|[1-3][0-9])$/;

const CATEGORY_OPTIONS = ['N', 'M', 'S', 'R'] as const;
const TYPE_OPTIONS = ['H', 'D'] as const;

type CategoryOption = (typeof CATEGORY_OPTIONS)[number];
type TypeOption = (typeof TYPE_OPTIONS)[number];

interface PatrolCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  label?: string;
}

export function normalisePatrolCode(raw: string) {
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) return '';

  const cleaned = trimmed.replace(/[^A-Z0-9-]/g, '');
  const match = cleaned.match(/^([NMSR])(.*)$/);
  if (!match) {
    return cleaned;
  }

  const [, category, remainder] = match;
  const trailingHyphen = /-$/.test(cleaned);
  const compact = remainder.replace(/-/g, '');

  if (!compact) {
    return category;
  }

  const letterMatchIndex = compact.search(/[HD]/);
  const hasLetter = letterMatchIndex === 0;
  const letter = hasLetter ? compact[0] : '';
  const digits = compact
    .slice(hasLetter ? 1 : 0)
    .replace(/[^0-9]/g, '')
    .slice(0, 2);

  let result = category;

  if (letter) {
    result += letter;
  }

  if (digits) {
    result += `-${digits}`;
  } else if (letter || (trailingHyphen && category)) {
    result += '-';
  }

  return result;
}

export default function PatrolCodeInput({ value, onChange, id, label }: PatrolCodeInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const feedbackId = `${inputId}-feedback`;

  const { normalisedValue, selectedCategory, selectedType, digits } = useMemo(() => {
    const normalised = normalisePatrolCode(value);
    const categoryOption = CATEGORY_OPTIONS.find((option) => normalised.startsWith(option)) ?? '';
    const typeCandidate = normalised.charAt(1);
    const typeOption =
      categoryOption && TYPE_OPTIONS.includes(typeCandidate as TypeOption)
        ? (typeCandidate as TypeOption)
        : '';
    const digitsMatch = normalised.match(/-(\d{1,2})$/);

    return {
      normalisedValue: normalised,
      selectedCategory: categoryOption,
      selectedType: typeOption,
      digits: digitsMatch ? digitsMatch[1] : '',
    };
  }, [value]);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      let next = raw.toUpperCase();
      next = next.replace(/[^A-Z0-9-]/g, '');
      next = normalisePatrolCode(next);
      onChange(next);
    },
    [onChange],
  );

  const handleCategorySelect = useCallback(
    (option: CategoryOption) => {
      if (option === selectedCategory) {
        return;
      }

      let nextValue = option;

      if (selectedType) {
        nextValue += selectedType;
        nextValue += digits ? `-${digits}` : '-';
      } else if (digits) {
        nextValue += `-${digits}`;
      }

      onChange(nextValue);
    },
    [digits, onChange, selectedCategory, selectedType],
  );

  const handleTypeSelect = useCallback(
    (option: TypeOption) => {
      if (!selectedCategory || option === selectedType) {
        return;
      }

      let nextValue = `${selectedCategory}${option}`;
      nextValue += digits ? `-${digits}` : '-';

      onChange(nextValue);
    },
    [digits, onChange, selectedCategory, selectedType],
  );

  const isValid = PATROL_CODE_REGEX.test(normalisedValue.trim().toUpperCase());
  const shouldUseNumericKeyboard = normalisedValue.includes('-') && normalisedValue.length >= 3;

  return (
    <div className="patrol-code-input">
      {label ? (
        <label className="patrol-code-input__label" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <div className="patrol-code-input__selectors">
        <div className="patrol-code-input__options" role="group" aria-label="Kategorie hlídky">
          {CATEGORY_OPTIONS.map((option) => (
            <button
              type="button"
              key={option}
              className="patrol-code-input__option"
              onClick={() => handleCategorySelect(option)}
              aria-pressed={selectedCategory === option}
            >
              {option}
            </button>
          ))}
        </div>
        <div
          className="patrol-code-input__options"
          role="group"
          aria-label="Družina nebo hlídka"
          aria-disabled={!selectedCategory}
        >
          {TYPE_OPTIONS.map((option) => (
            <button
              type="button"
              key={option}
              className="patrol-code-input__option"
              onClick={() => handleTypeSelect(option)}
              aria-pressed={selectedType === option}
              disabled={!selectedCategory}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <input
        id={inputId}
        value={normalisedValue}
        onChange={handleChange}
        placeholder="např. NH-15"
        autoComplete="off"
        inputMode={shouldUseNumericKeyboard ? 'numeric' : 'text'}
        pattern="[A-Za-z0-9-]*"
        aria-describedby={feedbackId}
      />
      <small id={feedbackId} className={isValid ? 'valid' : 'invalid'}>
        {isValid ? 'Kód je platný' : 'Formát: N/M/S/R + H/D + číslo 1–39 (např. NH-5)'}
      </small>
    </div>
  );
}
