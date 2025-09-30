import { useCallback } from 'react';

const PATROL_CODE_REGEX = /^[NMSR][HD]-(?:[1-9]|[1-3][0-9])$/;

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

  let result = category + letter;

  if (digits) {
    result += `-${digits}`;
  } else if (trailingHyphen && letter) {
    result += '-';
  }

  return result;
}

export default function PatrolCodeInput({ value, onChange, id, label }: PatrolCodeInputProps) {
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

  const isValid = PATROL_CODE_REGEX.test(value.trim().toUpperCase());
  const shouldUseNumericKeyboard = value.includes('-') && value.length >= 3;

  return (
    <label className="patrol-code-input" htmlFor={id}>
      {label ? <span>{label}</span> : null}
      <input
        id={id}
        value={value}
        onChange={handleChange}
        placeholder="např. NH-15"
        autoComplete="off"
        inputMode={shouldUseNumericKeyboard ? 'numeric' : 'text'}
        pattern="[A-Za-z0-9-]*"
      />
      <small className={isValid ? 'valid' : 'invalid'}>
        {isValid ? 'Kód je platný' : 'Formát: N/M/S/R + H/D + číslo 1–39 (např. NH-5)'}
      </small>
    </label>
  );
}
