import { forwardRef, useCallback, useEffect, useId, useMemo, useRef } from 'react';
import type { KeyboardEvent, MutableRefObject } from 'react';

type PointsOption = string;

interface PointsInputProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  label?: string;
  min?: number;
  max?: number;
  helperText?: string;
  clearLabel?: string;
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

function resolveSelectedValue(raw: string, min: number, max: number) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return '';
  }
  return String(parsed);
}

const PointsInput = forwardRef<HTMLButtonElement, PointsInputProps>(function PointsInput(
  {
    value,
    onChange,
    id,
    label,
    min,
    max,
    helperText,
    clearLabel = 'Vymazat výběr',
  },
  ref,
) {
  const [resolvedMin, resolvedMax] = normaliseBounds(min, max);
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const labelId = label ? `${inputId}-label` : undefined;
  const helperId = `${inputId}-helper`;

  const options = useMemo(() => {
    return Array.from(
      { length: resolvedMax - resolvedMin + 1 },
      (_, index) => String(resolvedMin + index),
    ) as readonly PointsOption[];
  }, [resolvedMax, resolvedMin]);

  const selectedOption = useMemo(
    () => resolveSelectedValue(value, resolvedMin, resolvedMax),
    [value, resolvedMin, resolvedMax],
  );

  const helperMessage = helperText ?? `Vyber body v rozsahu ${resolvedMin} až ${resolvedMax}.`;
  const isValidSelection = selectedOption !== '';
  const displayValue = selectedOption ? `${selectedOption} b` : '—';

  const focusIndex = (() => {
    if (!selectedOption) {
      return 0;
    }
    const matchIndex = options.indexOf(selectedOption);
    return matchIndex >= 0 ? matchIndex : 0;
  })();

  const wheelRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const scrollTimeoutRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);
  const isInitialRenderRef = useRef(true);

  useEffect(() => {
    optionRefs.current = optionRefs.current.slice(0, options.length);
  }, [options.length]);

  const setFocusRef = useCallback(
    (node: HTMLButtonElement | null) => {
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        (ref as MutableRefObject<HTMLButtonElement | null>).current = node;
      }
    },
    [ref],
  );

  const updateWheelPadding = useCallback(() => {
    const wheel = wheelRef.current;
    if (!wheel) {
      return;
    }
    const firstOption = optionRefs.current.find((node) => node);
    if (!firstOption) {
      return;
    }
    const wheelHeight = wheel.clientHeight;
    if (wheelHeight <= 0) {
      return;
    }
    const optionHeight = firstOption.offsetHeight || 0;
    const padding = Math.max(0, wheelHeight / 2 - optionHeight / 2);
    wheel.style.setProperty('--wheel-padding', `${padding}px`);
  }, []);

  useEffect(() => {
    updateWheelPadding();
  }, [options.length, updateWheelPadding]);

  useEffect(() => {
    const handleResize = () => updateWheelPadding();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [updateWheelPadding]);

  const scrollToOption = useCallback((index: number, behavior: ScrollBehavior = 'smooth') => {
    const wheel = wheelRef.current;
    const optionNode = optionRefs.current[index];
    if (!wheel || !optionNode) {
      return;
    }

    const wheelHeight = wheel.clientHeight;
    const optionOffsetTop = optionNode.offsetTop;
    const optionHeight = optionNode.offsetHeight;
    const targetScrollTop = optionOffsetTop - wheelHeight / 2 + optionHeight / 2;

    programmaticScrollRef.current = true;
    if (typeof wheel.scrollTo === 'function') {
      wheel.scrollTo({ top: targetScrollTop, behavior });
    } else {
      wheel.scrollTop = targetScrollTop;
    }
    if (behavior === 'auto') {
      programmaticScrollRef.current = false;
    }
  }, []);

  const handleSelect = useCallback(
    (option: PointsOption) => {
      if (option === selectedOption) {
        const existingIndex = options.indexOf(option);
        if (existingIndex >= 0) {
          scrollToOption(existingIndex);
        }
        return;
      }
      onChange(option);
      const selectedIndex = options.indexOf(option);
      if (selectedIndex >= 0) {
        scrollToOption(selectedIndex);
      }
    },
    [onChange, options, scrollToOption, selectedOption],
  );

  const handleClear = useCallback(() => {
    onChange('');
  }, [onChange]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const nextIndex = currentIndex === 0 ? options.length - 1 : currentIndex - 1;
        handleSelect(options[nextIndex]);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        const nextIndex = currentIndex === options.length - 1 ? 0 : currentIndex + 1;
        handleSelect(options[nextIndex]);
      }
    },
    [handleSelect, options],
  );

  const handleWheelScroll = useCallback(() => {
    if (!wheelRef.current || options.length === 0) {
      return;
    }

    if (scrollTimeoutRef.current !== null) {
      window.clearTimeout(scrollTimeoutRef.current);
    }

    const programmaticScroll = programmaticScrollRef.current;
    scrollTimeoutRef.current = window.setTimeout(() => {
      if (programmaticScroll) {
        programmaticScrollRef.current = false;
        return;
      }

      const wheel = wheelRef.current;
      if (!wheel) {
        return;
      }

      const { top, height } = wheel.getBoundingClientRect();
      const centerY = top + height / 2;
      let closestIndex = -1;
      let shortestDistance = Number.POSITIVE_INFINITY;

      optionRefs.current.forEach((node, index) => {
        if (!node) {
          return;
        }
        const rect = node.getBoundingClientRect();
        const optionCenter = rect.top + rect.height / 2;
        const distance = Math.abs(optionCenter - centerY);
        if (distance < shortestDistance) {
          shortestDistance = distance;
          closestIndex = index;
        }
      });

      if (closestIndex >= 0) {
        const nextOption = options[closestIndex];
        if (nextOption !== selectedOption) {
          handleSelect(nextOption);
        } else {
          scrollToOption(closestIndex);
        }
      }
    }, 80);
  }, [handleSelect, options, scrollToOption, selectedOption]);

  useEffect(() => {
    if (options.length === 0) {
      return;
    }
    const nextIndex = selectedOption ? options.indexOf(selectedOption) : 0;
    if (nextIndex < 0) {
      return;
    }
    const behavior = isInitialRenderRef.current ? 'auto' : 'smooth';
    isInitialRenderRef.current = false;
    scrollToOption(nextIndex, behavior);
  }, [options, scrollToOption, selectedOption]);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current !== null) {
        window.clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  const registerOptionRef = useCallback(
    (index: number) => (node: HTMLButtonElement | null) => {
      optionRefs.current[index] = node;
      if (index === focusIndex) {
        setFocusRef(node);
      }
      if (node) {
        updateWheelPadding();
      }
    },
    [focusIndex, setFocusRef, updateWheelPadding],
  );

  return (
    <div className="points-input">
      {label ? (
        <span className="points-input__label" id={labelId}>
          {label}
        </span>
      ) : null}
      <div className="points-input__wheel-group">
        <div
          className="points-input__wheel"
          role="radiogroup"
          aria-labelledby={labelId}
          aria-describedby={helperId}
          ref={wheelRef}
          onScroll={handleWheelScroll}
        >
          {options.map((option, index) => {
            const isSelected = selectedOption === option;
            const className = [
              'points-input__wheel-option',
              isSelected ? 'points-input__wheel-option--selected' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <button
                type="button"
                role="radio"
                aria-checked={isSelected}
                key={option}
                className={className}
                onClick={() => handleSelect(option)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                ref={registerOptionRef(index)}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>
      <div className="points-input__value" aria-live="polite">
        {displayValue}
      </div>
      <div className="points-input__actions">
        <small id={helperId} className={isValidSelection ? undefined : 'invalid'}>
          {helperMessage}
        </small>
        {value ? (
          <button type="button" className="ghost points-input__clear" onClick={handleClear}>
            {clearLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
});

export default PointsInput;
