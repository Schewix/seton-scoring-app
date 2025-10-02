import { forwardRef, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, MutableRefObject } from 'react';
import { triggerHaptic } from '../utils/haptics';

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

const DEFAULT_ROW_HEIGHT = 48;
const HAPTIC_COOLDOWN_MS = 70;
const SNAP_INACTIVITY_DELAY_MS = 100;
const SNAP_COMPLETION_DELAY_MS = 220;

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
  const fallbackId = `${inputId}-fallback`;

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
  const rowHeightRef = useRef(DEFAULT_ROW_HEIGHT);
  const lastIndexRef = useRef<number | null>(null);
  const lastTickTimeRef = useRef(0);
  const scrollRafRef = useRef<number | null>(null);
  const pendingSnapHapticRef = useRef<number | null>(null);
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
    const optionHeight = firstOption.offsetHeight || DEFAULT_ROW_HEIGHT;
    const firstIndex = optionRefs.current.findIndex((node) => node === firstOption);
    const secondOption =
      firstIndex >= 0
        ? optionRefs.current.slice(firstIndex + 1).find((node) => node)
        : undefined;
    const rowHeightCandidate = secondOption
      ? Math.abs(secondOption.offsetTop - firstOption.offsetTop) || optionHeight
      : optionHeight;
    rowHeightRef.current = Math.max(1, Math.round(rowHeightCandidate));
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

  const queueSnapHaptic = useCallback(
    (delay = SNAP_COMPLETION_DELAY_MS) => {
      if (typeof window === 'undefined') {
        return;
      }
      if (pendingSnapHapticRef.current !== null) {
        window.clearTimeout(pendingSnapHapticRef.current);
      }
      pendingSnapHapticRef.current = window.setTimeout(() => {
        pendingSnapHapticRef.current = null;
        triggerHaptic('medium');
      }, delay);
    },
    [],
  );

  const scrollToOption = useCallback(
    (
      index: number,
      behavior: ScrollBehavior = 'smooth',
      options?: { triggerSnapHaptic?: boolean; skipProgrammaticFlag?: boolean },
    ) => {
    const wheel = wheelRef.current;
    const optionNode = optionRefs.current[index];
    if (!wheel || !optionNode) {
      return;
    }

    const wheelHeight = wheel.clientHeight;
    const optionOffsetTop = optionNode.offsetTop;
    const optionHeight = optionNode.offsetHeight;
    const targetScrollTop = optionOffsetTop - wheelHeight / 2 + optionHeight / 2;

    if (!options?.skipProgrammaticFlag) {
      programmaticScrollRef.current = true;
    }
    if (typeof wheel.scrollTo === 'function') {
      wheel.scrollTo({ top: targetScrollTop, behavior });
    } else {
      wheel.scrollTop = targetScrollTop;
    }
    lastIndexRef.current = index;
    if (behavior === 'auto' && !options?.skipProgrammaticFlag) {
      programmaticScrollRef.current = false;
    }
    if (options?.triggerSnapHaptic) {
      queueSnapHaptic();
    }
  }, [queueSnapHaptic]);

  const handleSelect = useCallback(
    (option: PointsOption, behavior: ScrollBehavior = 'smooth') => {
      if (option === selectedOption) {
        const existingIndex = options.indexOf(option);
        if (existingIndex >= 0) {
          scrollToOption(existingIndex, behavior, {
            triggerSnapHaptic: behavior !== 'auto',
          });
        }
        return;
      }
      onChange(option);
      const selectedIndex = options.indexOf(option);
      if (selectedIndex >= 0) {
        scrollToOption(selectedIndex, behavior, {
          triggerSnapHaptic: behavior !== 'auto',
        });
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(() => {
            optionRefs.current[selectedIndex]?.focus({ preventScroll: true });
          });
        } else {
          optionRefs.current[selectedIndex]?.focus({ preventScroll: true });
        }
      }
      triggerHaptic('selection');
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

  const processScroll = useCallback(() => {
    scrollRafRef.current = null;
    const wheel = wheelRef.current;
    if (!wheel || options.length === 0) {
      return;
    }
    const rowHeight = rowHeightRef.current || DEFAULT_ROW_HEIGHT;
    if (rowHeight <= 0) {
      return;
    }
    const rawIndex = Math.floor(wheel.scrollTop / rowHeight);
    const clampedIndex = Math.max(0, Math.min(options.length - 1, rawIndex));
    const previousIndex = lastIndexRef.current;
    if (previousIndex === null) {
      lastIndexRef.current = clampedIndex;
      return;
    }
    if (clampedIndex === previousIndex) {
      return;
    }
    lastIndexRef.current = clampedIndex;
    if (programmaticScrollRef.current) {
      return;
    }
    const direction = clampedIndex > previousIndex ? 1 : -1;
    let currentIndex = previousIndex;
    while ((direction > 0 && currentIndex < clampedIndex) || (direction < 0 && currentIndex > clampedIndex)) {
      currentIndex += direction;
      if (currentIndex < 0 || currentIndex >= options.length) {
        continue;
      }
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - lastTickTimeRef.current >= HAPTIC_COOLDOWN_MS) {
        triggerHaptic('selection');
        lastTickTimeRef.current = now;
      }
    }
  }, [options.length]);

  const scheduleScrollProcessing = useCallback(() => {
    if (scrollRafRef.current !== null) {
      return;
    }
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      processScroll();
      return;
    }
    scrollRafRef.current = window.requestAnimationFrame(processScroll);
  }, [processScroll]);

  const finalizeScroll = useCallback(() => {
    const wheel = wheelRef.current;
    if (!wheel || options.length === 0) {
      return;
    }
    const rowHeight = rowHeightRef.current || DEFAULT_ROW_HEIGHT;
    if (rowHeight <= 0) {
      return;
    }
    const rawIndex = Math.round(wheel.scrollTop / rowHeight);
    const clampedIndex = Math.max(0, Math.min(options.length - 1, rawIndex));
    const nextOption = options[clampedIndex];
    if (!nextOption) {
      return;
    }
    if (nextOption !== selectedOption) {
      handleSelect(nextOption);
      return;
    }
    scrollToOption(clampedIndex, 'smooth', { triggerSnapHaptic: true });
  }, [handleSelect, options, scrollToOption, selectedOption]);

  const handleWheelScroll = useCallback(() => {
    if (!wheelRef.current || options.length === 0) {
      return;
    }
    scheduleScrollProcessing();
    if (typeof window === 'undefined') {
      finalizeScroll();
      return;
    }
    if (scrollTimeoutRef.current !== null) {
      window.clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = window.setTimeout(() => {
      if (programmaticScrollRef.current) {
        programmaticScrollRef.current = false;
        return;
      }
      finalizeScroll();
    }, SNAP_INACTIVITY_DELAY_MS);
  }, [finalizeScroll, options.length, scheduleScrollProcessing]);

  useEffect(() => {
    if (options.length === 0) {
      lastIndexRef.current = null;
      return;
    }
    const nextIndex = selectedOption ? options.indexOf(selectedOption) : 0;
    if (nextIndex < 0) {
      lastIndexRef.current = 0;
      return;
    }
    lastIndexRef.current = nextIndex;
    const behavior = isInitialRenderRef.current ? 'auto' : 'smooth';
    isInitialRenderRef.current = false;
    scrollToOption(nextIndex, behavior);
  }, [options, scrollToOption, selectedOption]);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current !== null) {
        window.clearTimeout(scrollTimeoutRef.current);
      }
      if (scrollRafRef.current !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(scrollRafRef.current);
      }
      if (pendingSnapHapticRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(pendingSnapHapticRef.current);
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

  const showWheel = !prefersReducedMotion;

  return (
    <div className="points-input">
      {label ? (
        <span className="points-input__label" id={labelId}>
          {label}
        </span>
      ) : null}
      {showWheel ? (
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
      ) : null}
      <div className="points-input__fallback">
        <label htmlFor={fallbackId}>Zadat body ručně</label>
        <input
          id={fallbackId}
          type="number"
          inputMode="numeric"
          min={resolvedMin}
          max={resolvedMax}
          value={value || ''}
          onChange={handleFallbackChange}
          aria-describedby={helperId}
          aria-labelledby={labelId}
          placeholder="—"
          step={1}
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
