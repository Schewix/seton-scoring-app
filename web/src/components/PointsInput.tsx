import { forwardRef, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, MutableRefObject } from 'react';

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

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    setPrefersReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return prefersReducedMotion;
}

function triggerHaptic(pattern: number | number[]) {
  if (typeof navigator === 'undefined') {
    return;
  }

  if ('vibrate' in navigator && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(pattern);
    } catch (error) {
      // Ignored – not all platforms allow vibration.
    }
  }
}

function formatPointsForScreenReaders(value: number) {
  if (value === 1) {
    return '1 bod';
  }
  if (value >= 2 && value <= 4) {
    return `${value} body`;
  }
  return `${value} bodů`;
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
  const displayNumber = selectedOption || '—';
  const displayUnit = selectedOption ? 'B' : '';

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
  const prefersReducedMotion = usePrefersReducedMotion();

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
    (option: PointsOption, behavior: ScrollBehavior = 'smooth') => {
      if (option === selectedOption) {
        const existingIndex = options.indexOf(option);
        if (existingIndex >= 0) {
          scrollToOption(existingIndex, behavior);
        }
        return;
      }
      onChange(option);
      const selectedIndex = options.indexOf(option);
      if (selectedIndex >= 0) {
        scrollToOption(selectedIndex, behavior);
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(() => {
            optionRefs.current[selectedIndex]?.focus({ preventScroll: true });
          });
        } else {
          optionRefs.current[selectedIndex]?.focus({ preventScroll: true });
        }
      }
      triggerHaptic(10);
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
        const nextIndex = Math.max(0, currentIndex - 1);
        handleSelect(options[nextIndex], 'auto');
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        const nextIndex = Math.min(options.length - 1, currentIndex + 1);
        handleSelect(options[nextIndex], 'auto');
      } else if (event.key === 'PageUp') {
        event.preventDefault();
        const nextIndex = Math.max(0, currentIndex - 3);
        handleSelect(options[nextIndex], 'auto');
      } else if (event.key === 'PageDown') {
        event.preventDefault();
        const nextIndex = Math.min(options.length - 1, currentIndex + 3);
        handleSelect(options[nextIndex], 'auto');
      } else if (event.key === 'Home') {
        event.preventDefault();
        handleSelect(options[0], 'auto');
      } else if (event.key === 'End') {
        event.preventDefault();
        handleSelect(options[options.length - 1], 'auto');
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
    },
    [focusIndex, setFocusRef],
  );

  const handleFallbackChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value;
      if (nextValue === '') {
        onChange('');
        return;
      }

      const parsed = Number.parseInt(nextValue, 10);
      if (!Number.isInteger(parsed)) {
        return;
      }

      const clamped = Math.min(resolvedMax, Math.max(resolvedMin, parsed));
      onChange(String(clamped));
    },
    [onChange, resolvedMax, resolvedMin],
  );

  const selectedForScreenReader = selectedOption
    ? formatPointsForScreenReaders(Number(selectedOption))
    : 'Bez výběru';

  return (
    <div className="points-input">
      {label ? (
        <span className="points-input__label" id={labelId}>
          {label}
        </span>
      ) : null}
      {prefersReducedMotion ? (
        <div className="points-input__fallback">
          <input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={resolvedMin}
            max={resolvedMax}
            value={selectedOption}
            onChange={handleFallbackChange}
            aria-describedby={helperId}
            aria-labelledby={labelId}
            placeholder="—"
            step={1}
          />
        </div>
      ) : (
        <div className="points-input__wheel-group">
          <div
            className="points-input__wheel"
            role="listbox"
            aria-labelledby={labelId}
            aria-describedby={helperId}
            aria-activedescendant={selectedOption ? `${inputId}-${selectedOption}` : undefined}
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
                  id={`${inputId}-${option}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-label={formatPointsForScreenReaders(Number(option))}
                  key={option}
                  className={className}
                  onClick={() => handleSelect(option, 'auto')}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                  ref={registerOptionRef(index)}
                  tabIndex={isSelected ? 0 : -1}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </div>
      )}
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
        <span className="sr-only">{selectedForScreenReader}</span>
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
