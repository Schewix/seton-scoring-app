
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { triggerHaptic } from '../utils/haptics';

const PATROL_CODE_REGEX = /^[NMSR][HD]-(?:0?[1-9]|[1-3][0-9]|40)$/;

const CATEGORY_OPTIONS = ['N', 'M', 'S', 'R'] as const;
const GENDER_OPTIONS = ['H', 'D'] as const;
const PAGE_JUMP = 5;
const WHEEL_ITEM_HEIGHT = 48;
const DEFAULT_ROW_HEIGHT = WHEEL_ITEM_HEIGHT;
const WHEEL_HAPTIC_COOLDOWN_MS = 70;
const WHEEL_SNAP_INACTIVITY_DELAY_MS = 110;
const WHEEL_SNAP_COMPLETION_DELAY_MS = 220;

export type CategoryOption = (typeof CATEGORY_OPTIONS)[number];
export type GenderOption = (typeof GENDER_OPTIONS)[number];

function isCategoryOption(value: string): value is CategoryOption {
  return (CATEGORY_OPTIONS as readonly string[]).includes(value);
}

function isGenderOption(value: string): value is GenderOption {
  return (GENDER_OPTIONS as readonly string[]).includes(value);
}

export interface PatrolRegistryEntry {
  id: string;
  code: string;
  category: string;
  gender: string;
  number: string;
  active: boolean;
}

export interface PatrolCodeRegistryState {
  loading: boolean;
  entries: readonly PatrolRegistryEntry[];
  error?: string | null;
}

export type PatrolValidationReason =
  | 'loading'
  | 'error'
  | 'incomplete'
  | 'format'
  | 'not-found'
  | 'inactive'
  | 'valid';

export interface PatrolValidationState {
  code: string;
  valid: boolean;
  patrolId?: string;
  reason: PatrolValidationReason;
  message: string;
}

interface WheelColumnOption {
  value: string;
  label: string;
  title?: string;
  disabled?: boolean;
}

interface WheelColumnProps {
  options: readonly WheelColumnOption[];
  selected: string;
  onSelect: (option: string) => void;
  ariaLabel: string;
  optionIdPrefix: string;
  disabled?: boolean;
}

interface PatrolCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  registry: PatrolCodeRegistryState;
  onValidationChange?: (state: PatrolValidationState) => void;
  id?: string;
  label?: string;
}

function logInteraction(event: string, payload: Record<string, unknown>) {
  if (typeof console === 'undefined') {
    return;
  }
  console.info(`[patrol-code-input] ${event}`, payload);
}

function formatNumberLabel(raw: string) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return raw;
  }
  return parsed.toString().padStart(2, '0');
}

function formatDisplayValue(normalised: string) {
  if (!normalised) {
    return '';
  }
  const fullMatch = normalised.match(/^([NMSR])([HD])-(\d{1,2})$/);
  if (fullMatch) {
    return `${fullMatch[1]}-${fullMatch[2]}-${fullMatch[3].padStart(2, '0')}`;
  }
  const partialGender = normalised.match(/^([NMSR])([HD])$/);
  if (partialGender) {
    return `${partialGender[1]}-${partialGender[2]}`;
  }
  if (/^([NMSR])([HD])-$/.test(normalised)) {
    return `${normalised[0]}-${normalised[1]}-`;
  }
  if (/^([NMSR])-$/.test(normalised)) {
    return `${normalised[0]}-`;
  }
  return normalised;
}

function normaliseNumber(raw: string) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return '';
  }
  return String(parsed);
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
    return trailingHyphen ? `${category}-` : category;
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
    const parsedDigits = Number.parseInt(digits, 10);
    if (Number.isFinite(parsedDigits) && parsedDigits > 0) {
      result += `-${parsedDigits}`;
    }
  } else if (letter || (trailingHyphen && category)) {
    result += '-';
  }

  return result;
}

export default function PatrolCodeInput({
  value,
  onChange,
  registry,
  onValidationChange,
  id,
  label,
}: PatrolCodeInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const labelId = label ? `${inputId}-label` : undefined;
  const feedbackId = `${inputId}-feedback`;
  const fallbackId = `${inputId}-fallback`;

  const normalisedValue = useMemo(() => normalisePatrolCode(value), [value]);

  const { selectedCategory, selectedGender, selectedNumber } = useMemo(() => {
    const category = CATEGORY_OPTIONS.find((option) => normalisedValue.startsWith(option)) ?? '';
    const genderCandidate = normalisedValue.charAt(1);
    const gender =
      category && isGenderOption(genderCandidate) ? (genderCandidate as GenderOption) : '';
    const digitsMatch = normalisedValue.match(/-(\d{1,2})$/);
    const parsedNumber = digitsMatch ? Number.parseInt(digitsMatch[1], 10) : NaN;
    const number = Number.isNaN(parsedNumber) ? '' : String(parsedNumber);
    return {
      selectedCategory: category ?? '',
      selectedGender: gender ?? '',
      selectedNumber: number ?? '',
    };
  }, [normalisedValue]);

  const registryEntries = registry.entries ?? [];

  const registryMap = useMemo(() => {
    const map = new Map<string, PatrolRegistryEntry>();
    registryEntries.forEach((entry) => {
      const normalized = normalisePatrolCode(entry.code ?? '');
      if (!normalized) {
        return;
      }
      map.set(normalized, entry);
    });
    return map;
  }, [registryEntries]);

  const numbersByGroup = useMemo(() => {
    const map = new Map<string, WheelColumnOption[]>();

    registryEntries.forEach((entry) => {
      const category = entry.category?.trim().toUpperCase() ?? '';
      const gender = entry.gender?.trim().toUpperCase() ?? '';
      if (!isCategoryOption(category) || !isGenderOption(gender)) {
        return;
      }
      const numberValue = normaliseNumber(entry.number ?? '');
      if (!numberValue) {
        return;
      }
      const key = `${category}${gender}`;
      const bucket = map.get(key) ?? [];
      const isInactive = entry.active === false;
      const option: WheelColumnOption = {
        value: numberValue,
        label: formatNumberLabel(numberValue),
        disabled: isInactive,
        title: isInactive ? 'Číslo je obsazené' : undefined,
      };
      const existingIndex = bucket.findIndex((item) => item.value === option.value);
      if (existingIndex >= 0) {
        if (bucket[existingIndex].disabled && entry.active !== false) {
          bucket[existingIndex] = option;
        }
      } else {
        bucket.push(option);
      }
      map.set(key, bucket);
    });

    map.forEach((bucket, key) => {
      const sorted = bucket
        .slice()
        .sort((a, b) => Number.parseInt(a.value, 10) - Number.parseInt(b.value, 10));
      map.set(key, sorted);
    });

    return map;
  }, [registryEntries]);

  const availableNumberOptions = useMemo<WheelColumnOption[]>(() => {
    if (!selectedCategory || !selectedGender) {
      return [];
    }
    const key = `${selectedCategory}${selectedGender}`;
    return numbersByGroup.get(key) ?? [];
  }, [numbersByGroup, selectedCategory, selectedGender]);

  useEffect(() => {
    if (!selectedCategory || !selectedGender) {
      return;
    }
    const key = `${selectedCategory}${selectedGender}`;
    const scoped = numbersByGroup.get(key);
    if (!scoped || scoped.length === 0) {
      if (selectedNumber) {
        onChange(`${selectedCategory}${selectedGender}-`);
      }
      return;
    }
    const match = scoped.find((option) => option.value === selectedNumber);
    if (!match || match.disabled) {
      const fallback = scoped.find((option) => !option.disabled) ?? null;
      if (fallback) {
        onChange(`${selectedCategory}${selectedGender}-${fallback.value}`);
      } else if (selectedNumber) {
        onChange(`${selectedCategory}${selectedGender}-`);
      }
    }
  }, [numbersByGroup, onChange, selectedCategory, selectedGender, selectedNumber]);

  const [fallbackText, setFallbackText] = useState(() => formatDisplayValue(normalisedValue));
  const isFallbackEditingRef = useRef(false);

  useEffect(() => {
    if (isFallbackEditingRef.current) {
      return;
    }
    setFallbackText(formatDisplayValue(normalisedValue));
  }, [normalisedValue]);

  const handleCategorySelect = useCallback(
    (option: string) => {
      if (!isCategoryOption(option) || option === selectedCategory) {
        return;
      }
      let nextValue = option;
      if (selectedGender) {
        nextValue += selectedGender;
        const scoped = numbersByGroup.get(`${option}${selectedGender}`);
        const preferred = scoped?.find((item) => !item.disabled) ?? null;
        nextValue += preferred ? `-${preferred.value}` : '-';
      }
      logInteraction('category-change', { category: option });
      onChange(nextValue);
    },
    [numbersByGroup, onChange, selectedCategory, selectedGender],
  );

  const handleGenderSelect = useCallback(
    (option: string) => {
      if (!selectedCategory || !isGenderOption(option) || option === selectedGender) {
        return;
      }
      const scoped = numbersByGroup.get(`${selectedCategory}${option}`);
      const preferred = scoped?.find((item) => !item.disabled) ?? null;
      let nextValue = `${selectedCategory}${option}`;
      nextValue += preferred ? `-${preferred.value}` : '-';
      logInteraction('gender-change', { category: selectedCategory, gender: option });
      onChange(nextValue);
    },
    [numbersByGroup, onChange, selectedCategory, selectedGender],
  );

  const handleNumberSelect = useCallback(
    (option: string) => {
      if (!selectedCategory || !selectedGender || option === selectedNumber) {
        return;
      }
      logInteraction('number-change', {
        category: selectedCategory,
        gender: selectedGender,
        number: option,
      });
      onChange(`${selectedCategory}${selectedGender}-${option}`);
    },
    [onChange, selectedCategory, selectedGender, selectedNumber],
  );

  const handleFallbackFocus = useCallback(() => {
    isFallbackEditingRef.current = true;
  }, []);

  const handleFallbackBlur = useCallback(() => {
    isFallbackEditingRef.current = false;
    setFallbackText(formatDisplayValue(normalisedValue));
  }, [normalisedValue]);

  const handleFallbackChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value.toUpperCase();
      setFallbackText(raw);
      const next = normalisePatrolCode(raw);
      logInteraction('manual-input', { raw, next });
      onChange(next);
    },
    [onChange],
  );

  const validationState = useMemo<PatrolValidationState>(() => {
    const canonical = normalisedValue;
    if (registry.loading) {
      return {
        code: canonical,
        valid: false,
        reason: 'loading',
        message: 'Načítám dostupná čísla hlídek…',
      };
    }
    if (registry.error) {
      return {
        code: canonical,
        valid: false,
        reason: 'error',
        message: registry.error || 'Nepodařilo se načíst dostupná čísla hlídek.',
      };
    }
    if (!selectedCategory || !selectedGender || !selectedNumber) {
      return {
        code: canonical,
        valid: false,
        reason: 'incomplete',
        message: 'Vyber kategorii, pohlaví a číslo hlídky.',
      };
    }
    if (!PATROL_CODE_REGEX.test(canonical)) {
      return {
        code: canonical,
        valid: false,
        reason: 'format',
        message: 'Formát kódu je neplatný.',
      };
    }
    const entry = registryMap.get(canonical);
    if (!entry) {
      return {
        code: canonical,
        valid: false,
        reason: 'not-found',
        message: 'Tato kombinace neexistuje. Zvol jiné číslo hlídky.',
      };
    }
    if (entry.active === false) {
      return {
        code: canonical,
        valid: false,
        patrolId: entry.id,
        reason: 'inactive',
        message: 'Tato kombinace neexistuje. Zvol jiné číslo hlídky.',
      };
    }
    return {
      code: canonical,
      valid: true,
      patrolId: entry.id,
      reason: 'valid',
      message: 'Kód je platný',
    };
  }, [normalisedValue, registry.error, registry.loading, registryMap, selectedCategory, selectedGender, selectedNumber]);

  const lastValidationRef = useRef<PatrolValidationState | null>(null);
  useEffect(() => {
    if (!onValidationChange) {
      return;
    }
    const prev = lastValidationRef.current;
    if (
      !prev ||
      prev.code !== validationState.code ||
      prev.valid !== validationState.valid ||
      prev.reason !== validationState.reason ||
      prev.patrolId !== validationState.patrolId ||
      prev.message !== validationState.message
    ) {
      onValidationChange(validationState);
      logInteraction('validation', {
        code: validationState.code,
        valid: validationState.valid,
        reason: validationState.reason,
      });
      lastValidationRef.current = validationState;
    }
  }, [onValidationChange, validationState]);

  const wheelOptionsCategory = useMemo(
    () => CATEGORY_OPTIONS.map((value) => ({ value, label: value })),
    [],
  );
  const wheelOptionsGender = useMemo(
    () =>
      GENDER_OPTIONS.map((value) => ({
        value,
        label: value,
        title: value === 'H' ? 'Hoši' : 'Dívky',
      })),
    [],
  );

  const displayValue = formatDisplayValue(normalisedValue) || '—';
  const wheelIsDisabled = registry.loading || Boolean(registry.error);

  return (
    <div className="patrol-code-input">
      {label ? (
        <span className="patrol-code-input__label" id={labelId}>
          {label}
        </span>
      ) : null}
      <div className="patrol-code-input__wheel-headings" aria-hidden="true">
        <span>Kategorie</span>
        <span>Pohlaví</span>
        <span>Číslo hlídky</span>
      </div>
      <div
        className={`patrol-code-input__wheel-group${wheelIsDisabled ? ' is-disabled' : ''}`}
        role="group"
        aria-labelledby={labelId}
      >
        <WheelColumn
          options={wheelOptionsCategory}
          selected={selectedCategory}
          onSelect={handleCategorySelect}
          ariaLabel="Kategorie"
          optionIdPrefix={`${inputId}-category-option`}
          disabled={wheelIsDisabled}
        />
        <WheelColumn
          options={wheelOptionsGender}
          selected={selectedGender}
          onSelect={handleGenderSelect}
          ariaLabel="Pohlaví (H = hoši, D = dívky)"
          optionIdPrefix={`${inputId}-gender-option`}
          disabled={wheelIsDisabled || !selectedCategory}
        />
        <WheelColumn
          options={availableNumberOptions}
          selected={selectedNumber}
          onSelect={handleNumberSelect}
          ariaLabel="Číslo hlídky"
          optionIdPrefix={`${inputId}-number-option`}
          disabled={wheelIsDisabled || !selectedCategory || !selectedGender}
        />
        {wheelIsDisabled ? (
          <div className="patrol-code-input__wheel-skeleton" aria-hidden="true">
            <div />
            <div />
            <div />
          </div>
        ) : null}
      </div>
      <div className="patrol-code-input__value" aria-live="polite">
        {displayValue}
      </div>
      <small
        id={feedbackId}
        className={validationState.valid ? 'valid' : 'invalid'}
        aria-live="polite"
      >
        {validationState.message}
      </small>
      <div className="patrol-code-input__fallback">
        <label htmlFor={fallbackId}>Zadat kód ručně</label>
        <input
          id={fallbackId}
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck="false"
          autoCapitalize="characters"
          value={fallbackText}
          onChange={handleFallbackChange}
          onFocus={handleFallbackFocus}
          onBlur={handleFallbackBlur}
          placeholder="N-H-07"
          aria-describedby={feedbackId}
          aria-invalid={!validationState.valid}
        />
      </div>
    </div>
  );
}

function WheelColumn({
  options,
  selected,
  onSelect,
  ariaLabel,
  optionIdPrefix,
  disabled = false,
}: WheelColumnProps) {
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const scrollTimeoutRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);
  const lastScrollInfoRef = useRef<{ top: number; timestamp: number; velocity: number }>({
    top: 0,
    timestamp: 0,
    velocity: 0,
  });
  const rowHeightRef = useRef(DEFAULT_ROW_HEIGHT);
  const lastIndexRef = useRef<number | null>(null);
  const lastTickTimeRef = useRef(0);
  const scrollRafRef = useRef<number | null>(null);
  const pendingSnapHapticRef = useRef<number | null>(null);
  const isInitialRenderRef = useRef(true);

  useEffect(() => {
    optionRefs.current = optionRefs.current.slice(0, options.length);
  }, [options.length]);

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

  const queueSnapHaptic = useCallback(
    (delay = WHEEL_SNAP_COMPLETION_DELAY_MS) => {
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
    const optionHeight = optionNode.offsetHeight || WHEEL_ITEM_HEIGHT;
    const targetScrollTop = optionOffsetTop - wheelHeight / 2 + optionHeight / 2;
    if (!options?.skipProgrammaticFlag) {
      programmaticScrollRef.current = true;
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    lastScrollInfoRef.current = {
      top: targetScrollTop,
      timestamp: now,
      velocity: 0,
    };
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

  const findNextEnabled = useCallback(
    (startIndex: number, direction: 1 | -1, wrap: boolean) => {
      if (!options.length) {
        return -1;
      }
      let index = startIndex;
      for (let i = 0; i < options.length; i += 1) {
        if (!wrap && (index < 0 || index >= options.length)) {
          return -1;
        }
        const currentIndex = wrap ? (index + options.length) % options.length : index;
        const option = options[currentIndex];
        if (option && !option.disabled) {
          return currentIndex;
        }
        index += direction;
      }
      return -1;
    },
    [options],
  );

  const handleOptionSelect = useCallback(
    (option: WheelColumnOption) => {
      if (disabled || option.disabled) {
        return;
      }
      if (option.value === selected) {
        const existingIndex = options.findIndex((item) => item.value === option.value);
        if (existingIndex >= 0) {
          scrollToOption(existingIndex, 'smooth', { triggerSnapHaptic: true });
        }
        return;
      }
      onSelect(option.value);
      const selectedIndex = options.findIndex((item) => item.value === option.value);
      if (selectedIndex >= 0) {
        scrollToOption(selectedIndex, 'smooth', { triggerSnapHaptic: true });
        triggerHaptic('selection');
      }
    },
    [disabled, onSelect, options, scrollToOption, selected],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
      if (disabled) {
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const nextIndex = findNextEnabled(currentIndex - 1, -1, true);
        if (nextIndex >= 0 && nextIndex !== currentIndex) {
          handleOptionSelect(options[nextIndex]);
        }
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        const nextIndex = findNextEnabled(currentIndex + 1, 1, true);
        if (nextIndex >= 0 && nextIndex !== currentIndex) {
          handleOptionSelect(options[nextIndex]);
        }
      } else if (event.key === 'PageUp') {
        event.preventDefault();
        const target = Math.max(0, currentIndex - PAGE_JUMP);
        const nextIndex = findNextEnabled(target, -1, false);
        if (nextIndex >= 0 && nextIndex !== currentIndex) {
          handleOptionSelect(options[nextIndex]);
        }
      } else if (event.key === 'PageDown') {
        event.preventDefault();
        const target = Math.min(options.length - 1, currentIndex + PAGE_JUMP);
        const nextIndex = findNextEnabled(target, 1, false);
        if (nextIndex >= 0 && nextIndex !== currentIndex) {
          handleOptionSelect(options[nextIndex]);
        }
      } else if (event.key === 'Home') {
        event.preventDefault();
        const nextIndex = findNextEnabled(0, 1, false);
        if (nextIndex >= 0) {
          handleOptionSelect(options[nextIndex]);
        }
      } else if (event.key === 'End') {
        event.preventDefault();
        const nextIndex = findNextEnabled(options.length - 1, -1, false);
        if (nextIndex >= 0) {
          handleOptionSelect(options[nextIndex]);
        }
      }
    },
    [disabled, findNextEnabled, handleOptionSelect, options],
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
    if (programmaticScrollRef.current || disabled) {
      return;
    }
    const direction = clampedIndex > previousIndex ? 1 : -1;
    let currentIndex = previousIndex;
    while ((direction > 0 && currentIndex < clampedIndex) || (direction < 0 && currentIndex > clampedIndex)) {
      currentIndex += direction;
      if (currentIndex < 0 || currentIndex >= options.length) {
        continue;
      }
      if (options[currentIndex]?.disabled) {
        continue;
      }
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - lastTickTimeRef.current >= WHEEL_HAPTIC_COOLDOWN_MS) {
        triggerHaptic('selection');
        lastTickTimeRef.current = now;
      }
    }
  }, [disabled, options]);

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
    let targetIndex = Math.max(0, Math.min(options.length - 1, rawIndex));
    if (options[targetIndex]?.disabled) {
      const forward = findNextEnabled(targetIndex + 1, 1, true);
      const backward = findNextEnabled(targetIndex - 1, -1, true);
      if (forward < 0 && backward < 0) {
        return;
      }
      if (forward < 0) {
        targetIndex = backward;
      } else if (backward < 0) {
        targetIndex = forward;
      } else {
        const baseNode = optionRefs.current[targetIndex];
        const forwardNode = forward >= 0 ? optionRefs.current[forward] : null;
        const backwardNode = backward >= 0 ? optionRefs.current[backward] : null;
        const baseTop = baseNode ? baseNode.offsetTop : targetIndex * rowHeight;
        const forwardDistance = forwardNode
          ? Math.abs(forwardNode.offsetTop - baseTop)
          : Math.abs(forward - targetIndex) * rowHeight;
        const backwardDistance = backwardNode
          ? Math.abs(backwardNode.offsetTop - baseTop)
          : Math.abs(backward - targetIndex) * rowHeight;
        targetIndex = forwardDistance <= backwardDistance ? forward : backward;
      }
    }
    const targetOption = options[targetIndex];
    if (!targetOption || targetOption.disabled) {
      return;
    }
    if (targetOption.value !== selected) {
      handleOptionSelect(targetOption);
      return;
    }
    scrollToOption(targetIndex, 'smooth', { triggerSnapHaptic: true });
  }, [findNextEnabled, handleOptionSelect, optionRefs, options, scrollToOption, selected]);

  const handleScroll = useCallback(() => {
    if (disabled || !wheelRef.current || options.length === 0) {
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
    const wheel = wheelRef.current;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const currentTop = wheel.scrollTop;
    const last = lastScrollInfoRef.current;
    const deltaTime = Math.max(1, now - last.timestamp);
    const velocity = (currentTop - last.top) / deltaTime;
    lastScrollInfoRef.current = {
      top: currentTop,
      timestamp: now,
      velocity,
    };
    const attemptSettle = () => {
      if (programmaticScrollRef.current) {
        programmaticScrollRef.current = false;
        return;
      }
      const nowCheck = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const timeSinceLastScroll = nowCheck - lastScrollInfoRef.current.timestamp;
      const latestVelocity = Math.abs(lastScrollInfoRef.current.velocity);
      if (timeSinceLastScroll < WHEEL_SNAP_INACTIVITY_DELAY_MS || latestVelocity > 0.05) {
        scrollTimeoutRef.current = window.setTimeout(
          attemptSettle,
          Math.max(40, Math.floor(WHEEL_SNAP_INACTIVITY_DELAY_MS / 2)),
        );
        return;
      }
      finalizeScroll();
    };
    scrollTimeoutRef.current = window.setTimeout(attemptSettle, WHEEL_SNAP_INACTIVITY_DELAY_MS);
  }, [disabled, finalizeScroll, options.length, scheduleScrollProcessing]);

  useEffect(() => {
    if (options.length === 0) {
      lastIndexRef.current = null;
      return;
    }
    const nextIndex = selected ? options.findIndex((option) => option.value === selected) : 0;
    if (nextIndex < 0) {
      lastIndexRef.current = 0;
      return;
    }
    lastIndexRef.current = nextIndex;
    const behavior = isInitialRenderRef.current ? 'auto' : 'smooth';
    isInitialRenderRef.current = false;
    scrollToOption(nextIndex, behavior);
  }, [options, scrollToOption, selected]);

  const registerOptionRef = useCallback(
    (index: number) => (node: HTMLButtonElement | null) => {
      optionRefs.current[index] = node;
      if (node) {
        updateWheelPadding();
      }
    },
    [updateWheelPadding],
  );

  return (
    <div
      className="patrol-code-input__wheel"
      role="listbox"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      ref={wheelRef}
      onScroll={handleScroll}
    >
      {options.map((option, index) => {
        const isSelected = selected === option.value;
        const optionId = `${optionIdPrefix}-${index}`;
        const className = [
          'patrol-code-input__wheel-option',
          isSelected ? 'patrol-code-input__wheel-option--selected' : '',
          option.disabled ? 'patrol-code-input__wheel-option--disabled' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <button
            type="button"
            role="option"
            aria-selected={isSelected}
            id={optionId}
            key={`${optionId}-${option.value}`}
            className={className}
            onClick={() => handleOptionSelect(option)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            disabled={disabled || option.disabled}
            ref={registerOptionRef(index)}
            title={option.title}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
