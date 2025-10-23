
import { KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef } from 'react';
import Picker from 'react-mobile-picker';
import { triggerHaptic } from '../utils/haptics';

const PATROL_CODE_REGEX = /^[NMSR][HD]-(?:0?[1-9]|[1-3][0-9]|40)$/;

const CATEGORY_OPTIONS = ['N', 'M', 'S', 'R'] as const;
const GENDER_OPTIONS = ['H', 'D'] as const;
const WHEEL_ITEM_HEIGHT = 48;
const WHEEL_VISIBLE_COUNT = 5;
const PLACEHOLDER_VALUE = '__';
const PAGE_JUMP = 5;

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

interface PatrolCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  registry: PatrolCodeRegistryState;
  onValidationChange?: (state: PatrolValidationState) => void;
  id?: string;
  label?: string;
  excludePatrolIds?: ReadonlySet<string> | null;
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
    return `${fullMatch[1]}${fullMatch[2]}-${fullMatch[3].padStart(2, '0')}`;
  }
  const partialGender = normalised.match(/^([NMSR])([HD])$/);
  if (partialGender) {
    return `${partialGender[1]}${partialGender[2]}`;
  }
  if (/^([NMSR])([HD])-$/.test(normalised)) {
    return `${normalised[0]}${normalised[1]}-`;
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

type PatrolCodePickerValue = {
  category: string;
  gender: string;
  number: string;
};

function isPlaceholder(value: string) {
  return value === PLACEHOLDER_VALUE;
}

export default function PatrolCodeInput({
  value,
  onChange,
  registry,
  onValidationChange,
  id,
  label,
  excludePatrolIds,
}: PatrolCodeInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const labelId = label ? `${inputId}-label` : undefined;
  const feedbackId = `${inputId}-feedback`;

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

  const excludedPatrolIdSet = useMemo(() => {
    if (!excludePatrolIds) {
      return null;
    }
    const values: string[] = [];
    excludePatrolIds.forEach((id) => {
      if (typeof id === 'string' && id.length > 0) {
        values.push(id);
      }
    });
    if (values.length === 0) {
      return null;
    }
    return new Set(values);
  }, [excludePatrolIds]);

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
      if (excludedPatrolIdSet?.has(entry.id)) {
        return;
      }
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
  }, [excludedPatrolIdSet, registryEntries]);

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
      const firstAvailable = scoped.find((option) => !option.disabled) ?? null;
      if (firstAvailable) {
        onChange(`${selectedCategory}${selectedGender}-${firstAvailable.value}`);
      } else if (selectedNumber) {
        onChange(`${selectedCategory}${selectedGender}-`);
      }
    }
  }, [numbersByGroup, onChange, selectedCategory, selectedGender, selectedNumber]);

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
      triggerHaptic('selection');
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
      triggerHaptic('selection');
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
      triggerHaptic('selection');
      onChange(`${selectedCategory}${selectedGender}-${option}`);
    },
    [onChange, selectedCategory, selectedGender, selectedNumber],
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
        message: '',
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
    () =>
      [
        { value: PLACEHOLDER_VALUE, label: '—', title: 'Vyber kategorii' },
        ...CATEGORY_OPTIONS.map((value) => ({ value, label: value })),
      ],
    [],
  );
  const wheelOptionsGender = useMemo(
    () =>
      [
        { value: PLACEHOLDER_VALUE, label: '—', title: 'Vyber pohlaví' },
        ...GENDER_OPTIONS.map((value) => ({
          value,
          label: value,
          title: value === 'H' ? 'Hoši' : 'Dívky',
        })),
      ],
    [],
  );

  const numberColumnOptions = useMemo(() => {
    const baseOptions = availableNumberOptions.map((option) => ({ ...option }));
    const placeholderTitle =
      baseOptions.length > 0 ? 'Vyber číslo hlídky' : 'Žádná čísla nejsou k dispozici';
    return [
      {
        value: PLACEHOLDER_VALUE,
        label: '—',
        title: placeholderTitle,
        disabled: baseOptions.length === 0,
      },
      ...baseOptions,
    ];
  }, [availableNumberOptions]);

  const pickerValue = useMemo<PatrolCodePickerValue>(
    () => ({
      category: selectedCategory || PLACEHOLDER_VALUE,
      gender: selectedGender || PLACEHOLDER_VALUE,
      number: selectedNumber || PLACEHOLDER_VALUE,
    }),
    [selectedCategory, selectedGender, selectedNumber],
  );

  const wheelIsDisabled = registry.loading || Boolean(registry.error);
  const displayValue = formatDisplayValue(normalisedValue) || '—';

  const handleColumnValueSelect = useCallback(
    (column: keyof PatrolCodePickerValue, nextOption: string) => {
      if (wheelIsDisabled) {
        return;
      }
      if (column === 'category') {
        if (isPlaceholder(nextOption)) {
          if (normalisedValue) {
            onChange('');
          }
          return;
        }
        if (isCategoryOption(nextOption)) {
          handleCategorySelect(nextOption);
        }
        return;
      }
      if (column === 'gender') {
        if (!selectedCategory) {
          return;
        }
        if (isPlaceholder(nextOption)) {
          onChange(`${selectedCategory}-`);
          return;
        }
        if (isGenderOption(nextOption)) {
          handleGenderSelect(nextOption);
        }
        return;
      }
      if (!selectedCategory || !selectedGender) {
        return;
      }
      if (isPlaceholder(nextOption)) {
        onChange(`${selectedCategory}${selectedGender}-`);
        return;
      }
      const keyId = `${selectedCategory}${selectedGender}`;
      const scoped = numbersByGroup.get(keyId) ?? [];
      const match = scoped.find((option) => option.value === nextOption) ?? null;
      if (match?.disabled) {
        const targetIndex = scoped.findIndex((option) => option.value === nextOption);
        if (targetIndex >= 0) {
          for (let offset = 1; offset < scoped.length; offset += 1) {
            const forward = scoped[targetIndex + offset];
            if (forward && !forward.disabled) {
              handleNumberSelect(forward.value);
              return;
            }
            const backward = scoped[targetIndex - offset];
            if (backward && !backward.disabled) {
              handleNumberSelect(backward.value);
              return;
            }
          }
        }
        onChange(`${selectedCategory}${selectedGender}-`);
        return;
      }
      handleNumberSelect(nextOption);
    },
    [
      handleCategorySelect,
      handleGenderSelect,
      handleNumberSelect,
      normalisedValue,
      numbersByGroup,
      onChange,
      selectedCategory,
      selectedGender,
      wheelIsDisabled,
    ],
  );

  const handlePickerChange = useCallback(
    (nextValue: PatrolCodePickerValue, key: string) => {
      const nextOption = String(nextValue[key as keyof PatrolCodePickerValue] ?? '');
      handleColumnValueSelect(key as keyof PatrolCodePickerValue, nextOption);
    },
    [handleColumnValueSelect],
  );

  const handleColumnKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>, column: keyof PatrolCodePickerValue) => {
      const config = {
        category: {
          options: wheelOptionsCategory,
          selectedValue: pickerValue.category,
          disabled: wheelIsDisabled,
        },
        gender: {
          options: wheelOptionsGender,
          selectedValue: pickerValue.gender,
          disabled: wheelIsDisabled || !selectedCategory,
        },
        number: {
          options: numberColumnOptions,
          selectedValue: pickerValue.number,
          disabled: wheelIsDisabled || !selectedCategory || !selectedGender,
        },
      }[column];

      if (!config || config.disabled) {
        return;
      }

      const { options, selectedValue } = config;
      if (!options.length) {
        return;
      }

      const findNextEnabledIndex = (
        startIndex: number,
        direction: 1 | -1,
        wrap: boolean,
      ) => {
        if (!options.length) {
          return -1;
        }
        let index = startIndex;
        for (let i = 0; i < options.length; i += 1) {
          if (!wrap && (index < 0 || index >= options.length)) {
            return -1;
          }
          const currentIndex = wrap
            ? (index + options.length) % options.length
            : index;
          const option = options[currentIndex];
          if (option && !option.disabled) {
            return currentIndex;
          }
          index += direction;
        }
        return -1;
      };

      const currentIndex = options.findIndex((option) => option.value === selectedValue);
      const fallbackIndex = findNextEnabledIndex(0, 1, false);
      const activeIndex = currentIndex >= 0 ? currentIndex : fallbackIndex;

      if (activeIndex < 0) {
        return;
      }

      const moveToIndex = (nextIndex: number) => {
        if (nextIndex < 0 || nextIndex === activeIndex) {
          return;
        }
        const option = options[nextIndex];
        if (!option || option.disabled) {
          return;
        }
        handleColumnValueSelect(column, option.value);
      };

      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const nextIndex = findNextEnabledIndex(activeIndex - 1, -1, true);
        moveToIndex(nextIndex);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        const nextIndex = findNextEnabledIndex(activeIndex + 1, 1, true);
        moveToIndex(nextIndex);
      } else if (event.key === 'PageUp') {
        event.preventDefault();
        const target = Math.max(0, activeIndex - PAGE_JUMP);
        const nextIndex = findNextEnabledIndex(target, -1, false);
        moveToIndex(nextIndex);
      } else if (event.key === 'PageDown') {
        event.preventDefault();
        const target = Math.min(options.length - 1, activeIndex + PAGE_JUMP);
        const nextIndex = findNextEnabledIndex(target, 1, false);
        moveToIndex(nextIndex);
      } else if (event.key === 'Home') {
        event.preventDefault();
        const nextIndex = findNextEnabledIndex(0, 1, false);
        moveToIndex(nextIndex);
      } else if (event.key === 'End') {
        event.preventDefault();
        const nextIndex = findNextEnabledIndex(options.length - 1, -1, false);
        moveToIndex(nextIndex);
      }
    },
    [
      handleColumnValueSelect,
      numberColumnOptions,
      pickerValue,
      selectedCategory,
      selectedGender,
      wheelIsDisabled,
      wheelOptionsCategory,
      wheelOptionsGender,
    ],
  );

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
        <div className="picker-highlight" aria-hidden="true" />
        <Picker
          className="patrol-code-input__picker"
          value={pickerValue}
          onChange={handlePickerChange}
          height={WHEEL_ITEM_HEIGHT * WHEEL_VISIBLE_COUNT}
          itemHeight={WHEEL_ITEM_HEIGHT}
          wheelMode="natural"
          aria-label="Výběr hlídky"
        >
          <Picker.Column
            name="category"
            className="patrol-code-input__picker-column"
            aria-label="Kategorie"
            role="listbox"
            tabIndex={wheelIsDisabled ? -1 : 0}
            onKeyDown={(event) => handleColumnKeyDown(event, 'category')}
            aria-disabled={wheelIsDisabled ? true : undefined}
            data-disabled={wheelIsDisabled ? 'true' : undefined}
          >
            {wheelOptionsCategory.map((option, index) => (
              <Picker.Item
                key={`${inputId}-category-option-${index}`}
                value={option.value}
                className="patrol-code-input__picker-item"
                title={option.title}
                data-disabled={option.disabled ? 'true' : undefined}
                role="option"
                aria-selected={pickerValue.category === option.value}
                aria-disabled={option.disabled || wheelIsDisabled ? true : undefined}
              >
                {({ selected }) => (
                  <span
                    className="patrol-code-input__picker-item-label"
                    data-selected={selected ? 'true' : undefined}
                    data-disabled={option.disabled ? 'true' : undefined}
                  >
                    {option.label}
                  </span>
                )}
              </Picker.Item>
            ))}
          </Picker.Column>
          <Picker.Column
            name="gender"
            className="patrol-code-input__picker-column"
            aria-label="Pohlaví (H = hoši, D = dívky)"
            role="listbox"
            tabIndex={wheelIsDisabled || !selectedCategory ? -1 : 0}
            onKeyDown={(event) => handleColumnKeyDown(event, 'gender')}
            aria-disabled={
              wheelIsDisabled || !selectedCategory ? true : undefined
            }
            data-disabled={
              wheelIsDisabled || !selectedCategory ? 'true' : undefined
            }
          >
            {wheelOptionsGender.map((option, index) => (
              <Picker.Item
                key={`${inputId}-gender-option-${index}`}
                value={option.value}
                className="patrol-code-input__picker-item"
                title={option.title}
                data-disabled={
                  option.disabled || wheelIsDisabled || !selectedCategory ? 'true' : undefined
                }
                role="option"
                aria-selected={pickerValue.gender === option.value}
                aria-disabled={
                  option.disabled || wheelIsDisabled || !selectedCategory ? true : undefined
                }
              >
                {({ selected }) => (
                  <span
                    className="patrol-code-input__picker-item-label"
                    data-selected={selected ? 'true' : undefined}
                    data-disabled={
                      option.disabled || wheelIsDisabled || !selectedCategory
                        ? 'true'
                        : undefined
                    }
                  >
                    {option.label}
                  </span>
                )}
              </Picker.Item>
            ))}
          </Picker.Column>
          <Picker.Column
            name="number"
            className="patrol-code-input__picker-column"
            aria-label="Číslo hlídky"
            role="listbox"
            tabIndex={
              wheelIsDisabled || !selectedCategory || !selectedGender ? -1 : 0
            }
            onKeyDown={(event) => handleColumnKeyDown(event, 'number')}
            aria-disabled={
              wheelIsDisabled || !selectedCategory || !selectedGender
                ? true
                : undefined
            }
            data-disabled={
              wheelIsDisabled || !selectedCategory || !selectedGender ? 'true' : undefined
            }
          >
            {numberColumnOptions.map((option, index) => (
              <Picker.Item
                key={`${inputId}-number-option-${index}`}
                value={option.value}
                className="patrol-code-input__picker-item"
                title={option.title}
                data-disabled={
                  option.disabled || wheelIsDisabled || !selectedCategory || !selectedGender
                    ? 'true'
                    : undefined
                }
                role="option"
                aria-selected={pickerValue.number === option.value}
                aria-disabled={
                  option.disabled || wheelIsDisabled || !selectedCategory || !selectedGender
                    ? true
                    : undefined
                }
              >
                {({ selected }) => (
                  <span
                    className="patrol-code-input__picker-item-label"
                    data-selected={selected ? 'true' : undefined}
                    data-disabled={
                      option.disabled || wheelIsDisabled || !selectedCategory || !selectedGender
                        ? 'true'
                        : undefined
                    }
                  >
                    {option.label}
                  </span>
                )}
              </Picker.Item>
            ))}
          </Picker.Column>
        </Picker>
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
      {validationState.message ? (
        <small
          id={feedbackId}
          className={validationState.valid ? 'valid' : 'invalid'}
          aria-live="polite"
        >
          {validationState.message}
        </small>
      ) : null}
    </div>
  );
}
