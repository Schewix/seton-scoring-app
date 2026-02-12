import { forwardRef, useCallback, useId, useMemo, type ChangeEvent } from 'react';

interface PointsInputProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  label?: string;
  min?: number;
  max?: number;
  helperText?: string;
}

function normaliseBounds(min: number | undefined, max: number | undefined) {
  if (typeof min === 'number' && typeof max === 'number') {
    return min <= max ? [min, max] : [max, min];
  }
  if (typeof min === 'number') {
    return [min, min + 12];
  }
  if (typeof max === 'number') {
    return [Math.max(0, max - 12), max];
  }
  return [0, 12];
}

const PointsInput = forwardRef<HTMLInputElement, PointsInputProps>(function PointsInput(
  {
    value,
    onChange,
    id,
    label,
    min,
    max,
    helperText,
  },
  ref,
) {
  const [resolvedMin, resolvedMax] = normaliseBounds(min, max);
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const labelId = label ? `${inputId}-label` : undefined;
  const helperId = `${inputId}-helper`;

  const parsedValue = useMemo(() => {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(parsed)) {
      return null;
    }
    return parsed;
  }, [value]);

  const isValidSelection =
    parsedValue !== null && parsedValue >= resolvedMin && parsedValue <= resolvedMax;
  const displayNumber = isValidSelection ? String(parsedValue) : '—';
  const displayUnit = isValidSelection ? 'B' : '';
  const helperMessage = helperText ?? `Zadej body v rozsahu ${resolvedMin} až ${resolvedMax}.`;

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      const trimmed = raw.trim();
      if (trimmed === '') {
        onChange('');
        return;
      }
      if (!/^\d{1,2}$/.test(trimmed)) {
        return;
      }
      const parsed = Number.parseInt(trimmed, 10);
      if (!Number.isInteger(parsed) || parsed < resolvedMin || parsed > resolvedMax) {
        return;
      }
      onChange(String(parsed));
    },
    [onChange, resolvedMax, resolvedMin],
  );

  return (
    <div className="points-input">
      {label ? (
        <label className="points-input__label" id={labelId} htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <div className="points-input__field">
        <input
          ref={ref}
          id={inputId}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={2}
          value={value}
          onChange={handleInputChange}
          placeholder={`${resolvedMin}-${resolvedMax}`}
          aria-describedby={helperId}
          aria-labelledby={labelId}
          aria-invalid={value !== '' && !isValidSelection ? true : undefined}
        />
      </div>
      <div className="points-input__value" aria-live="polite">
        <strong>
          <span className="points-input__value-number">{displayNumber}</span>
          {displayUnit ? (
            <>
              {' '}
              <span className="points-input__value-unit">{displayUnit}</span>
            </>
          ) : null}
        </strong>
      </div>
      <div className="points-input__actions">
        <small id={helperId} className={isValidSelection || value === '' ? undefined : 'invalid'}>
          {helperMessage}
        </small>
      </div>
    </div>
  );
});

export default PointsInput;
