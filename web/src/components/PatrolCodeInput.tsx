import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { supabase } from '../supabaseClient';

const CATEGORY_OPTIONS = ['N', 'M', 'S', 'R'] as const;
const GENDER_OPTIONS = ['H', 'D'] as const;
const HINT_BY_GENDER: Record<GenderOption, string> = {
  H: 'Hoši',
  D: 'Dívky',
};
const VISIBLE_ROWS = 5;

export type CategoryOption = (typeof CATEGORY_OPTIONS)[number];
export type GenderOption = (typeof GENDER_OPTIONS)[number];

interface WheelOption {
  value: string;
  label: string;
  disabled?: boolean;
  title?: string;
}

interface DirectoryEntry {
  id: string;
  category: CategoryOption;
  gender: GenderOption;
  number: string; // always padded to two digits
  code: string; // canonical format (e.g., NH-7)
  active: boolean;
}

interface PatrolCodeInputProps {
  eventId: string;
  allowedCategories: ReadonlySet<string>;
  onConfirm: (payload: { code: string; patrolId: string }) => Promise<void> | void;
  onChange?: (code: string) => void;
  id?: string;
  label?: string;
  disabled?: boolean;
}

type PatrolDirectory = Map<string, DirectoryEntry[]>; // key: `${category}-${gender}`

type PatrolRow = {
  id: string;
  category: CategoryOption;
  sex: GenderOption;
  patrol_code: string;
  active: boolean | null;
};

function isCategoryOption(value: string): value is CategoryOption {
  return CATEGORY_OPTIONS.includes(value as CategoryOption);
}

function isGenderOption(value: string): value is GenderOption {
  return GENDER_OPTIONS.includes(value as GenderOption);
}

function padNumber(value: string | number): string {
  const numeric = Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '';
  }
  return String(numeric).padStart(2, '0');
}

function parseManualParts(raw: string) {
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) {
    return null;
  }
  const cleaned = trimmed.replace(/[^A-Z0-9-]/g, '');
  const match = cleaned.match(/^([NMSR])[-\s]?([HD])[-\s]?(\d{1,2})$/);
  if (!match) {
    return null;
  }
  const [, cat, gen, digits] = match;
  if (!isCategoryOption(cat) || !isGenderOption(gen)) {
    return null;
  }
  const number = padNumber(digits);
  if (!number) {
    return null;
  }
  return { category: cat, gender: gen, number } as const;
}

function buildCanonicalCode(category: CategoryOption, gender: GenderOption, paddedNumber: string) {
  const numeric = Number.parseInt(paddedNumber, 10);
  if (!Number.isFinite(numeric)) {
    return '';
  }
  return `${category}${gender}-${numeric}`;
}

function formatDisplayCode(category: string, gender: string, paddedNumber: string) {
  if (!category || !gender || !paddedNumber) {
    return '—';
  }
  return `${category}-${gender}-${paddedNumber}`;
}

function getNavigator(): (Navigator & { vibrate?: (pattern: number | number[]) => boolean }) | null {
  if (typeof navigator === 'undefined') {
    return null;
  }
  return navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean };
}

function triggerSelectionHaptic() {
  if (typeof window === 'undefined') {
    return;
  }
  const globalAny = window as typeof window & {
    Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { Haptics?: { selectionChanged?: () => void; selection?: () => void } } };
    TapticEngine?: { selection: () => void };
  };
  const { Capacitor, TapticEngine } = globalAny;
  const navigatorWithVibrate = getNavigator();
  if (Capacitor?.isNativePlatform?.()) {
    const selection = Capacitor.Plugins?.Haptics?.selectionChanged || Capacitor.Plugins?.Haptics?.selection;
    if (selection) {
      selection();
      return;
    }
  }
  if (TapticEngine?.selection) {
    TapticEngine.selection();
    return;
  }
  const ua = navigatorWithVibrate?.userAgent ?? '';
  if (/android/i.test(ua) && typeof navigatorWithVibrate?.vibrate === 'function') {
    navigatorWithVibrate.vibrate(15);
  }
}

function triggerConfirmHaptic() {
  if (typeof window === 'undefined') {
    return;
  }
  const globalAny = window as typeof window & {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      Plugins?: { Haptics?: { impact?: (options: { style: 'medium' | 'heavy' }) => void; impactOccurred?: () => void } };
    };
    TapticEngine?: { impact?: ({ style }: { style: 'medium' | 'heavy' }) => void; notification?: ({ type }: { type: 'success' | 'warning' | 'error' }) => void };
  };
  const { Capacitor, TapticEngine } = globalAny;
  const navigatorWithVibrate = getNavigator();
  if (Capacitor?.isNativePlatform?.()) {
    const haptics = Capacitor.Plugins?.Haptics;
    if (haptics?.impact) {
      haptics.impact({ style: 'medium' });
      return;
    }
    if (haptics?.impactOccurred) {
      haptics.impactOccurred();
      return;
    }
  }
  if (TapticEngine?.impact) {
    TapticEngine.impact({ style: 'heavy' });
    return;
  }
  if (TapticEngine?.notification) {
    TapticEngine.notification({ type: 'success' });
    return;
  }
  const ua = navigatorWithVibrate?.userAgent ?? '';
  if (/android/i.test(ua) && typeof navigatorWithVibrate?.vibrate === 'function') {
    navigatorWithVibrate.vibrate([20, 30]);
  }
}

function logEvent(type: string, payload: Record<string, unknown>) {
  try {
    console.info(`[patrol-picker] ${type}`, payload);
  } catch (error) {
    // no-op if console unavailable
  }
}

export function normalisePatrolCode(raw: string) {
  const parts = parseManualParts(raw);
  if (!parts) {
    return raw.trim().toUpperCase().replace(/\s+/g, '');
  }
  return buildCanonicalCode(parts.category, parts.gender, parts.number);
}

export default function PatrolCodeInput({
  eventId,
  allowedCategories,
  onConfirm,
  onChange,
  id,
  label,
  disabled = false,
}: PatrolCodeInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const labelId = label ? `${inputId}-label` : undefined;
  const feedbackId = `${inputId}-feedback`;
  const fallbackId = `${inputId}-fallback`;
  const [directory, setDirectory] = useState<PatrolDirectory>(new Map());
  const [lookupByCode, setLookupByCode] = useState<Map<string, DirectoryEntry>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [category, setCategory] = useState<CategoryOption | ''>('');
  const [gender, setGender] = useState<GenderOption | ''>('');
  const [number, setNumber] = useState<string>('');
  const [manualInput, setManualInput] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const selectionRef = useRef<{ category: string; gender: string; number: string }>({
    category: '',
    gender: '',
    number: '',
  });

  const allowedCategoryOptions = useMemo(() => {
    if (allowedCategories.size === 0) {
      return new Set<CategoryOption>(CATEGORY_OPTIONS);
    }
    const set = new Set<CategoryOption>();
    CATEGORY_OPTIONS.forEach((option) => {
      if (allowedCategories.has(option)) {
        set.add(option);
      }
    });
    return set.size > 0 ? set : new Set<CategoryOption>(CATEGORY_OPTIONS);
  }, [allowedCategories]);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setLoadError(null);
    const fetchDirectory = async () => {
      const { data, error } = await supabase
        .from('patrols')
        .select('id, patrol_code, category, sex, active')
        .eq('event_id', eventId);
      if (!isMounted) {
        return;
      }
      if (error) {
        console.error('Failed to load patrol directory', error);
        setLoadError('Nepodařilo se načíst seznam hlídek.');
        setDirectory(new Map());
        setLookupByCode(new Map());
        setIsLoading(false);
        logEvent('load-error', { message: error.message, hint: error.hint });
        return;
      }
      const rows = Array.isArray(data) ? (data as PatrolRow[]) : [];
      const map: PatrolDirectory = new Map();
      const byCode = new Map<string, DirectoryEntry>();
      rows.forEach((row) => {
        if (!row || !row.patrol_code) {
          return;
        }
        let parts = parseManualParts(row.patrol_code);
        if (!parts) {
          const canonical = normalisePatrolCode(row.patrol_code);
          const fallbackParts = parseManualParts(canonical);
          if (!fallbackParts) {
            return;
          }
          parts = fallbackParts;
        }
        let { category: rowCategory, gender: rowGender, number: rowNumber } = parts;
        if (!isCategoryOption(rowCategory) || !isGenderOption(rowGender)) {
          return;
        }
        const isActive = row.active !== false;
        const entry: DirectoryEntry = {
          id: row.id,
          category: rowCategory,
          gender: rowGender,
          number: rowNumber,
          code: buildCanonicalCode(rowCategory, rowGender, rowNumber),
          active: isActive,
        };
        const key = `${rowCategory}-${rowGender}`;
        const bucket = map.get(key) ?? [];
        bucket.push(entry);
        map.set(key, bucket);
        byCode.set(entry.code, entry);
      });
      map.forEach((bucket) => {
        bucket.sort((a, b) => Number.parseInt(a.number, 10) - Number.parseInt(b.number, 10));
      });
      setDirectory(map);
      setLookupByCode(byCode);
      setIsLoading(false);
      const totals = Array.from(map.values()).flat().reduce(
        (acc, entry) => {
          acc.total += 1;
          if (!entry.active) {
            acc.unavailable += 1;
          }
          return acc;
        },
        { total: 0, unavailable: 0 },
      );
      if (totals.total > 0) {
        logEvent('availability', {
          total: totals.total,
          unavailable: totals.unavailable,
          unavailableRatio: totals.unavailable / totals.total,
        });
      }
    };
    void fetchDirectory();
    return () => {
      isMounted = false;
    };
  }, [eventId]);

  const categoryHasActive = useCallback(
    (candidate: CategoryOption) => {
      let hasActive = false;
      GENDER_OPTIONS.forEach((genderOption) => {
        const bucket = directory.get(`${candidate}-${genderOption}`);
        if (bucket && bucket.some((entry) => entry.active)) {
          hasActive = true;
        }
      });
      return hasActive;
    },
    [directory],
  );

  const findFirstAvailableCategory = useCallback(() => {
    for (const option of CATEGORY_OPTIONS) {
      if (!allowedCategoryOptions.has(option)) {
        continue;
      }
      if (categoryHasActive(option)) {
        return option;
      }
    }
    return '';
  }, [allowedCategoryOptions, categoryHasActive]);

  const findFirstAvailableGender = useCallback(
    (candidateCategory: CategoryOption | '') => {
      if (!candidateCategory) {
        return '';
      }
      for (const genderOption of GENDER_OPTIONS) {
        const bucket = directory.get(`${candidateCategory}-${genderOption}`) ?? [];
        if (bucket.some((entry) => entry.active)) {
          return genderOption;
        }
      }
      return '';
    },
    [directory],
  );

  const pickNextNumber = useCallback(
    (candidateCategory: CategoryOption | '', candidateGender: GenderOption | '', current: string) => {
      if (!candidateCategory || !candidateGender) {
        return '';
      }
      const bucket = directory.get(`${candidateCategory}-${candidateGender}`) ?? [];
      if (bucket.length === 0) {
        return '';
      }
      if (current) {
        const match = bucket.find((entry) => entry.number === current && entry.active);
        if (match) {
          return match.number;
        }
      }
      const activeEntry = bucket.find((entry) => entry.active);
      if (activeEntry) {
        return activeEntry.number;
      }
      return bucket[0]?.number ?? '';
    },
    [directory],
  );

  useEffect(() => {
    if (isLoading) {
      return;
    }
    setCategory((previous) => {
      if (previous && allowedCategoryOptions.has(previous) && categoryHasActive(previous)) {
        return previous;
      }
      const replacement = findFirstAvailableCategory();
      return replacement || '';
    });
  }, [allowedCategoryOptions, categoryHasActive, findFirstAvailableCategory, isLoading]);

  useEffect(() => {
    if (isLoading) {
      return;
    }
    setGender((previous) => {
      if (category && previous) {
        const bucket = directory.get(`${category}-${previous}`) ?? [];
        if (bucket.some((entry) => entry.active)) {
          return previous;
        }
      }
      if (!category) {
        return '';
      }
      const fallbackGender = findFirstAvailableGender(category);
      return fallbackGender || '';
    });
  }, [category, directory, findFirstAvailableGender, isLoading]);

  useEffect(() => {
    if (isLoading) {
      return;
    }
    setNumber((previous) => pickNextNumber(category, gender, previous));
  }, [category, gender, isLoading, pickNextNumber]);

  useEffect(() => {
    const current = selectionRef.current;
    if (current.category !== category || current.gender !== gender || current.number !== number) {
      selectionRef.current = { category: category ?? '', gender: gender ?? '', number };
      if (category && gender && number) {
        logEvent('selection-change', { category, gender, number });
      }
    }
  }, [category, gender, number]);

  const allNumbers = useMemo(() => {
    const set = new Set<string>();
    directory.forEach((bucket) => {
      bucket.forEach((entry) => set.add(entry.number));
    });
    const list = Array.from(set);
    list.sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
    return list;
  }, [directory]);

  const categoryOptions: WheelOption[] = useMemo(
    () =>
      CATEGORY_OPTIONS.map((option) => {
        const disabledOption =
          disabled ||
          !allowedCategoryOptions.has(option) ||
          !categoryHasActive(option);
        return { value: option, label: option, disabled: disabledOption };
      }),
    [allowedCategoryOptions, categoryHasActive, disabled],
  );

  const genderOptions: WheelOption[] = useMemo(() => {
    return GENDER_OPTIONS.map((option) => {
      if (!category) {
        return { value: option, label: option, title: HINT_BY_GENDER[option], disabled: true };
      }
      const bucket = directory.get(`${category}-${option}`) ?? [];
      const hasActive = bucket.some((entry) => entry.active);
      return {
        value: option,
        label: option,
        title: HINT_BY_GENDER[option],
        disabled: disabled || !hasActive,
      };
    });
  }, [category, directory, disabled]);

  const numberOptions: WheelOption[] = useMemo(() => {
    if (category && gender) {
      const bucket = directory.get(`${category}-${gender}`) ?? [];
      if (bucket.length === 0) {
        return allNumbers.map((value) => ({ value, label: value, disabled: true }));
      }
      return bucket.map((entry) => ({ value: entry.number, label: entry.number, disabled: disabled || !entry.active }));
    }
    if (allNumbers.length === 0) {
      return Array.from({ length: VISIBLE_ROWS }, (_, index) => ({
        value: `placeholder-${index}`,
        label: '—',
        disabled: true,
      }));
    }
    return allNumbers.map((value) => ({ value, label: value, disabled: true }));
  }, [allNumbers, category, directory, disabled, gender]);

  const selectedEntry = useMemo(() => {
    if (!category || !gender || !number) {
      return null;
    }
    const bucket = directory.get(`${category}-${gender}`) ?? [];
    return bucket.find((entry) => entry.number === number) ?? null;
  }, [category, directory, gender, number]);

  const canonicalCode = useMemo(() => {
    if (!category || !gender || !number) {
      return '';
    }
    return buildCanonicalCode(category, gender, number);
  }, [category, gender, number]);

  useEffect(() => {
    if (!onChange) {
      return;
    }
    if (selectedEntry && selectedEntry.active) {
      onChange(selectedEntry.code);
    } else {
      onChange('');
    }
  }, [onChange, selectedEntry]);

  const [isValid, validationMessage] = useMemo(() => {
    if (isLoading) {
      return [false, 'Načítám seznam hlídek…'] as const;
    }
    if (loadError) {
      return [false, loadError] as const;
    }
    if (!category || !gender || !number) {
      return [false, 'Vyber kategorii, pohlaví a číslo hlídky.'] as const;
    }
    if (!selectedEntry) {
      return [false, 'Tato kombinace neexistuje. Zvol jiné číslo hlídky.'] as const;
    }
    if (!selectedEntry.active) {
      return [false, 'Tato kombinace je již obsazená. Vyber jiné číslo.'] as const;
    }
    return [true, 'Kód je platný'] as const;
  }, [category, gender, isLoading, loadError, number, selectedEntry]);

  useEffect(() => {
    logEvent('validation', { code: canonicalCode || null, valid: isValid });
  }, [canonicalCode, isValid]);

  useEffect(() => {
    if (category && gender && number) {
      setManualInput(formatDisplayCode(category, gender, number));
    } else if (!category && !gender && !number) {
      setManualInput('');
    }
  }, [category, gender, number]);

  const handleCategorySelect = useCallback(
    (value: string) => {
      if (disabled) {
        return;
      }
      if (!isCategoryOption(value)) {
        return;
      }
      setCategory(value);
      setManualError(null);
    },
    [disabled],
  );

  const handleGenderSelect = useCallback(
    (value: string) => {
      if (disabled || !category) {
        return;
      }
      if (!isGenderOption(value)) {
        return;
      }
      setGender(value);
      setManualError(null);
    },
    [category, disabled],
  );

  const handleNumberSelect = useCallback(
    (value: string) => {
      if (disabled || !category || !gender) {
        return;
      }
      setNumber(value);
      setManualError(null);
    },
    [category, disabled, gender],
  );

  const applyManualInput = useCallback(() => {
    if (isLoading) {
      setManualError('Načítám seznam hlídek…');
      logEvent('manual-invalid', { reason: 'loading' });
      return;
    }
    if (!manualInput) {
      setManualError('Zadej kód ve tvaru N-H-07.');
      logEvent('manual-invalid', { reason: 'empty' });
      return;
    }
    const parts = parseManualParts(manualInput);
    if (!parts) {
      setManualError('Neplatný formát. Použij tvar N-H-07.');
      logEvent('manual-invalid', { reason: 'format', value: manualInput });
      return;
    }
    if (!allowedCategoryOptions.has(parts.category)) {
      setManualError('Tato kombinace neexistuje. Zvol jiné číslo hlídky.');
      logEvent('manual-invalid', { reason: 'category-disallowed', value: manualInput });
      return;
    }
    const bucket = directory.get(`${parts.category}-${parts.gender}`) ?? [];
    const entry = bucket.find((item) => item.number === parts.number);
    if (!entry || !entry.active) {
      setManualError('Tato kombinace neexistuje. Zvol jiné číslo hlídky.');
      logEvent('manual-invalid', { reason: 'combination-missing', value: manualInput });
      return;
    }
    setCategory(parts.category);
    setGender(parts.gender);
    setNumber(entry.number);
    setManualError(null);
    triggerSelectionHaptic();
    logEvent('manual-selection', { category: parts.category, gender: parts.gender, number: entry.number });
  }, [allowedCategoryOptions, directory, isLoading, manualInput]);

  const handleManualKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyManualInput();
      }
    },
    [applyManualInput],
  );

  const confirmDisabled = disabled || isLoading || isConfirming || !isValid || !selectedEntry;

  const handleConfirm = useCallback(async () => {
    if (confirmDisabled || !selectedEntry) {
      return;
    }
    setIsConfirming(true);
    try {
      triggerConfirmHaptic();
      logEvent('confirm', { code: selectedEntry.code, patrolId: selectedEntry.id });
      await onConfirm({ code: selectedEntry.code, patrolId: selectedEntry.id });
    } finally {
      setIsConfirming(false);
    }
  }, [confirmDisabled, onConfirm, selectedEntry]);

  const statusClassName = isValid ? 'valid' : 'invalid';
  const displayValue = formatDisplayCode(category, gender, number);

  return (
    <div className="patrol-code-input">
      {label ? (
        <span className="patrol-code-input__label" id={labelId}>
          {label}
        </span>
      ) : null}
      <div className="patrol-code-input__wheel-group" role="group" aria-labelledby={labelId}>
        <WheelColumn
          options={categoryOptions}
          selected={category}
          onSelect={handleCategorySelect}
          ariaLabel="Kategorie"
          disabled={disabled}
          onSnap={triggerSelectionHaptic}
        />
        <WheelColumn
          options={genderOptions}
          selected={gender}
          onSelect={handleGenderSelect}
          ariaLabel="Pohlaví"
          disabled={disabled || !category}
          onSnap={triggerSelectionHaptic}
        />
        <WheelColumn
          options={numberOptions}
          selected={number}
          onSelect={handleNumberSelect}
          ariaLabel="Číslo hlídky"
          disabled={disabled || !category || !gender}
          onSnap={triggerSelectionHaptic}
        />
      </div>
      <div className="patrol-code-input__value" aria-live="polite">
        {displayValue}
      </div>
      <small id={feedbackId} className={statusClassName} role="status" aria-live="polite">
        {validationMessage}
      </small>
      <div className="patrol-code-input__fallback">
        <label htmlFor={fallbackId}>Textové zadání (např. N-H-07)</label>
        <input
          id={fallbackId}
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck="false"
          value={manualInput}
          onChange={(event) => {
            setManualInput(event.target.value);
            setManualError(null);
          }}
          onBlur={() => {
            if (manualInput) {
              applyManualInput();
            }
          }}
          onKeyDown={handleManualKeyDown}
          aria-describedby={manualError ? `${fallbackId}-error` : undefined}
        />
        {manualError ? (
          <span id={`${fallbackId}-error`} className="patrol-code-input__error" role="alert">
            {manualError}
          </span>
        ) : null}
      </div>
      <div className="patrol-code-input__actions">
        <button
          type="button"
          className="primary"
          onClick={handleConfirm}
          disabled={confirmDisabled}
          aria-describedby={feedbackId}
        >
          Načíst hlídku
        </button>
      </div>
    </div>
  );
}

interface WheelColumnProps {
  options: readonly WheelOption[];
  selected: string;
  onSelect: (option: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  onSnap?: () => void;
}

function WheelColumn({ options, selected, onSelect, ariaLabel, disabled = false, onSnap }: WheelColumnProps) {
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const scrollTimeoutRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);
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
    const optionHeight = firstOption.offsetHeight || 0;
    if (optionHeight <= 0) {
      return;
    }
    const padding = Math.max(0, (optionHeight * VISIBLE_ROWS) / 2 - optionHeight / 2);
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

  useEffect(() => () => {
    if (scrollTimeoutRef.current !== null) {
      window.clearTimeout(scrollTimeoutRef.current);
    }
  }, []);

  const scrollToOption = useCallback(
    (index: number, behavior: ScrollBehavior = 'smooth') => {
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
    },
    [],
  );

  const findClosestEnabledIndex = useCallback(
    (startIndex: number) => {
      if (options.length === 0) {
        return -1;
      }
      if (!options[startIndex]?.disabled) {
        return startIndex;
      }
      for (let offset = 1; offset < options.length; offset += 1) {
        const before = startIndex - offset;
        if (before >= 0 && !options[before]?.disabled) {
          return before;
        }
        const after = startIndex + offset;
        if (after < options.length && !options[after]?.disabled) {
          return after;
        }
      }
      return -1;
    },
    [options],
  );

  const handleOptionSelect = useCallback(
    (option: string) => {
      if (disabled) {
        return;
      }
      const index = options.findIndex((item) => item.value === option);
      if (index < 0) {
        return;
      }
      if (options[index]?.disabled) {
        return;
      }
      onSelect(option);
      scrollToOption(index);
      onSnap?.();
    },
    [disabled, onSelect, onSnap, options, scrollToOption],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (disabled) {
        return;
      }
      const moveFocus = (step: number) => {
        let nextIndex = index;
        do {
          nextIndex = (nextIndex + step + options.length) % options.length;
        } while (options[nextIndex]?.disabled && nextIndex !== index);
        if (!options[nextIndex]?.disabled) {
          handleOptionSelect(options[nextIndex].value);
          optionRefs.current[nextIndex]?.focus();
        }
      };
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        moveFocus(-1);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        moveFocus(1);
      } else if (event.key === 'PageUp') {
        event.preventDefault();
        moveFocus(-VISIBLE_ROWS);
      } else if (event.key === 'PageDown') {
        event.preventDefault();
        moveFocus(VISIBLE_ROWS);
      }
    },
    [disabled, handleOptionSelect, options],
  );

  const finalizeScroll = useCallback(() => {
    const wheel = wheelRef.current;
    if (!wheel || options.length === 0) {
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
      const nearestEnabled = findClosestEnabledIndex(closestIndex);
      if (nearestEnabled >= 0) {
        const nextOption = options[nearestEnabled];
        if (nextOption.value !== selected) {
          onSelect(nextOption.value);
        }
        scrollToOption(nearestEnabled);
        onSnap?.();
      }
    }
  }, [findClosestEnabledIndex, onSelect, onSnap, options, scrollToOption, selected]);

  const handleScroll = useCallback(() => {
    if (disabled || !wheelRef.current || options.length === 0) {
      return;
    }
    if (scrollTimeoutRef.current !== null) {
      window.clearTimeout(scrollTimeoutRef.current);
    }
    const attemptSettle = () => {
      if (programmaticScrollRef.current) {
        programmaticScrollRef.current = false;
        return;
      }
      finalizeScroll();
    };
    scrollTimeoutRef.current = window.setTimeout(attemptSettle, 120);
  }, [disabled, finalizeScroll, options.length]);

  useEffect(() => {
    if (options.length === 0) {
      return;
    }
    let targetIndex = options.findIndex((option) => option.value === selected);
    if (targetIndex < 0) {
      targetIndex = findClosestEnabledIndex(0);
    }
    if (targetIndex < 0) {
      return;
    }
    const behavior = isInitialRenderRef.current ? 'auto' : 'smooth';
    isInitialRenderRef.current = false;
    scrollToOption(targetIndex, behavior);
  }, [findClosestEnabledIndex, options, scrollToOption, selected]);

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
        const optionId = `${ariaLabel.replace(/\s+/g, '-').toLowerCase()}-${option.value}`;
        const className = [
          'patrol-code-input__wheel-option',
          isSelected ? 'patrol-code-input__wheel-option--selected' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <button
            key={option.value}
            type="button"
            id={optionId}
            role="option"
            aria-selected={isSelected}
            aria-disabled={option.disabled || disabled || undefined}
            className={className}
            onClick={() => handleOptionSelect(option.value)}
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
