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
  const match = trimmed.match(/^([NMSR])([^\-]?)(.*)$/i);
  if (!match) return trimmed;
  const category = match[1].toUpperCase();
  let rest = match[3] ? match[3] : '';
  const second = match[2] ? match[2].toUpperCase() : '';
  if (second === 'H' || second === 'D') {
    rest = `${second}${rest}`;
  } else if (rest.startsWith('H') || rest.startsWith('D')) {
    // keep rest
  } else {
    rest = `-${second}${rest}`;
  }
  rest = rest.replace(/[^0-9HD-]/gi, '');
  if (!rest.startsWith('-')) {
    rest = `-${rest}`;
  }
  return `${category}${rest}`
    .replace(/-{2,}/g, '-')
    .replace(/-(?![0-9])/g, '-')
    .slice(0, 6);
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

  return (
    <label className="patrol-code-input" htmlFor={id}>
      {label ? <span>{label}</span> : null}
      <input
        id={id}
        value={value}
        onChange={handleChange}
        placeholder="např. NH-15"
        autoComplete="off"
        inputMode="text"
        pattern="[A-Za-z0-9-]*"
      />
      <small className={isValid ? 'valid' : 'invalid'}>
        {isValid ? 'Kód je platný' : 'Formát: N/M/S/R + H/D + číslo 1–39 (např. NH-5)'}
      </small>
    </label>
  );
}
