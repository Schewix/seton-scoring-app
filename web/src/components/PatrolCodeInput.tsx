
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react';
import Picker from 'react-mobile-picker';

const PATROL_CODE_REGEX = /^(N|M|S|R)(H|D)-(0[1-9]|[12][0-9]|3[0-9]|40)$/;
const PARTIAL_PATROL_CODE_REGEX = /^(?:[NMSR]|[NMSR]-|[NMSR][HD](?:-\d{0,2})?)$/;

const CATEGORY_OPTIONS = ['N', 'M', 'S', 'R'] as const;
const GENDER_OPTIONS = ['H', 'D'] as const;
const WHEEL_ITEM_HEIGHT = 48;
const WHEEL_VISIBLE_COUNT = 5;
const PLACEHOLDER_VALUE = '__';

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
  | 'category-not-allowed'
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
  allowedCategories?: ReadonlySet<string> | null;
  validationMode?: 'registry' | 'station-only';
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

function toCanonicalPatrolCode(normalised: string) {
  const fullMatch = normalised.match(/^([NMSR])([HD])-(\d{1,2})$/);
  if (!fullMatch) {
    return normalised;
  }
  return `${fullMatch[1]}${fullMatch[2]}-${fullMatch[3].padStart(2, '0')}`;
}

function parsePatrolCodeParts(normalised: string) {
  const fullMatch = normalised.match(/^([NMSR])([HD])-(\d{1,2})$/);
  if (!fullMatch) {
    return null;
  }
  return {
    category: fullMatch[1],
    gender: fullMatch[2],
    number: String(Number.parseInt(fullMatch[3], 10)),
  };
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
  allowedCategories,
  validationMode = 'registry',
}: PatrolCodeInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const labelId = label ? `${inputId}-label` : undefined;
  const feedbackId = `${inputId}-feedback`;
  const textInputId = `${inputId}-text`;
  const textHintId = `${inputId}-hint`;
  const showWheel = false;

  const normalisedValue = useMemo(() => normalisePatrolCode(value), [value]);
  const canonicalValue = useMemo(() => toCanonicalPatrolCode(normalisedValue), [normalisedValue]);
  const textInputValue = normalisedValue ? formatDisplayValue(normalisedValue) : '';

  const { manualCategory, manualGender, manualNumber } = useMemo(() => {
    const category = CATEGORY_OPTIONS.find((option) => normalisedValue.startsWith(option)) ?? '';
    const genderCandidate = normalisedValue.charAt(1);
    const gender =
      category && isGenderOption(genderCandidate) ? (genderCandidate as GenderOption) : '';
    const digitsMatch = normalisedValue.match(/-(\d{1,2})$/);
    const parsedNumber = digitsMatch ? Number.parseInt(digitsMatch[1], 10) : NaN;
    const number = Number.isNaN(parsedNumber) ? '' : String(parsedNumber);
    return {
      manualCategory: category ?? '',
      manualGender: gender ?? '',
      manualNumber: number ?? '',
    };
  }, [normalisedValue]);

  const [inputMode, setInputMode] = useState<'manual' | 'picker'>('manual');
  const [pickerValue, setPickerValue] = useState<PatrolCodePickerValue>({
    category: PLACEHOLDER_VALUE,
    gender: PLACEHOLDER_VALUE,
    number: PLACEHOLDER_VALUE,
  });
  const [isInputFocused, setIsInputFocused] = useState(false);

  const updatePickerValue = useCallback((nextValue: PatrolCodePickerValue) => {
    setPickerValue((previous) => {
      if (
        previous.category === nextValue.category &&
        previous.gender === nextValue.gender &&
        previous.number === nextValue.number
      ) {
        return previous;
      }
      return nextValue;
    });
  }, []);

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

  const isCategoryAllowed = useCallback(
    (category: string) => {
      if (!allowedCategories || allowedCategories.size === 0) {
        return true;
      }
      return allowedCategories.has(category);
    },
    [allowedCategories],
  );

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
    const selectedCategory = isPlaceholder(pickerValue.category) ? '' : pickerValue.category;
    const selectedGender = isPlaceholder(pickerValue.gender) ? '' : pickerValue.gender;
    if (!selectedCategory || !selectedGender) {
      return [];
    }
    const key = `${selectedCategory}${selectedGender}`;
    return numbersByGroup.get(key) ?? [];
  }, [numbersByGroup, pickerValue.category, pickerValue.gender]);

  useEffect(() => {
    const selectedCategory = isPlaceholder(pickerValue.category) ? '' : pickerValue.category;
    const selectedGender = isPlaceholder(pickerValue.gender) ? '' : pickerValue.gender;
    const selectedNumber = isPlaceholder(pickerValue.number) ? '' : pickerValue.number;
    if (!selectedCategory || !selectedGender) {
      return;
    }
    const key = `${selectedCategory}${selectedGender}`;
    const scoped = numbersByGroup.get(key);
    if (!scoped || scoped.length === 0) {
      if (selectedNumber) {
        updatePickerValue({
          category: selectedCategory,
          gender: selectedGender,
          number: PLACEHOLDER_VALUE,
        });
      }
      return;
    }
    const match = scoped.find((option) => option.value === selectedNumber);
    if (!match || match.disabled) {
      const firstAvailable = scoped.find((option) => !option.disabled) ?? null;
      if (firstAvailable) {
        updatePickerValue({
          category: selectedCategory,
          gender: selectedGender,
          number: firstAvailable.value,
        });
      } else if (selectedNumber) {
        updatePickerValue({
          category: selectedCategory,
          gender: selectedGender,
          number: PLACEHOLDER_VALUE,
        });
      }
    }
  }, [numbersByGroup, pickerValue.category, pickerValue.gender, pickerValue.number, updatePickerValue]);

  const validationState = useMemo<PatrolValidationState>(() => {
    const canonical = canonicalValue;
    const registryKey = normalisedValue;
    if (validationMode === 'registry') {
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
    }
    if (canonical && !PARTIAL_PATROL_CODE_REGEX.test(canonical)) {
      return {
        code: canonical,
        valid: false,
        reason: 'format',
        message: 'Formát kódu je neplatný.',
      };
    }
    if (manualCategory && !isCategoryAllowed(manualCategory)) {
      return {
        code: canonical,
        valid: false,
        reason: 'category-not-allowed',
        message: 'Hlídka této kategorie na stanoviště nepatří.',
      };
    }
    if (!manualCategory || !manualGender || !manualNumber) {
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
    if (validationMode === 'station-only') {
      return {
        code: canonical,
        valid: true,
        reason: 'valid',
        message: 'Kód je platný',
      };
    }
    const entry = registryMap.get(registryKey);
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
  }, [
    isCategoryAllowed,
    canonicalValue,
    normalisedValue,
    registry.error,
    registry.loading,
    registryMap,
    manualCategory,
    manualGender,
    manualNumber,
    validationMode,
  ]);

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
      lastValidationRef.current = validationState;
    }
  }, [onValidationChange, validationState]);

  const wheelOptionsCategory = useMemo<WheelColumnOption[]>(
    () =>
      [
        { value: PLACEHOLDER_VALUE, label: '—', title: 'Vyber kategorii' },
        ...CATEGORY_OPTIONS.map((value) => ({ value, label: value })),
      ],
    [],
  );
  const wheelOptionsGender = useMemo<WheelColumnOption[]>(
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

  const numberColumnOptions = useMemo<WheelColumnOption[]>(() => {
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

  const wheelIsDisabled = registry.loading || Boolean(registry.error);
  const wheelInteractionDisabled = wheelIsDisabled || isInputFocused;
  const selectedCategory = isPlaceholder(pickerValue.category) ? '' : pickerValue.category;
  const selectedGender = isPlaceholder(pickerValue.gender) ? '' : pickerValue.gender;
  const displayValue = formatDisplayValue(normalisedValue) || '—';

  const handlePickerChange = useCallback(
    (nextValue: PatrolCodePickerValue, key: string) => {
      const nextOption = String(nextValue[key as keyof PatrolCodePickerValue] ?? '');
      if (wheelInteractionDisabled) {
        return;
      }
      setInputMode('picker');
      const selectedCategory = isPlaceholder(pickerValue.category) ? '' : pickerValue.category;
      const selectedGender = isPlaceholder(pickerValue.gender) ? '' : pickerValue.gender;
      const selectedNumber = isPlaceholder(pickerValue.number) ? '' : pickerValue.number;
      if (key === 'category') {
        if (isPlaceholder(nextOption)) {
          updatePickerValue({
            category: PLACEHOLDER_VALUE,
            gender: PLACEHOLDER_VALUE,
            number: PLACEHOLDER_VALUE,
          });
          return;
        }
        if (isCategoryOption(nextOption)) {
          if (nextOption === selectedCategory) {
            return;
          }
          if (!selectedGender) {
            updatePickerValue({
              category: nextOption,
              gender: PLACEHOLDER_VALUE,
              number: PLACEHOLDER_VALUE,
            });
            return;
          }
          const scoped = numbersByGroup.get(`${nextOption}${selectedGender}`);
          const preferred = scoped?.find((item) => !item.disabled) ?? null;
          updatePickerValue({
            category: nextOption,
            gender: selectedGender,
            number: preferred ? preferred.value : PLACEHOLDER_VALUE,
          });
        }
        return;
      }
      if (key === 'gender') {
        if (!selectedCategory) {
          return;
        }
        if (isPlaceholder(nextOption)) {
          updatePickerValue({
            category: selectedCategory,
            gender: PLACEHOLDER_VALUE,
            number: PLACEHOLDER_VALUE,
          });
          return;
        }
        if (isGenderOption(nextOption)) {
          if (nextOption === selectedGender) {
            return;
          }
          const scoped = numbersByGroup.get(`${selectedCategory}${nextOption}`);
          const preferred = scoped?.find((item) => !item.disabled) ?? null;
          updatePickerValue({
            category: selectedCategory,
            gender: nextOption,
            number: preferred ? preferred.value : PLACEHOLDER_VALUE,
          });
        }
        return;
      }
      if (!selectedCategory || !selectedGender) {
        return;
      }
      if (isPlaceholder(nextOption)) {
        updatePickerValue({
          category: selectedCategory,
          gender: selectedGender,
          number: PLACEHOLDER_VALUE,
        });
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
              updatePickerValue({
                category: selectedCategory,
                gender: selectedGender,
                number: forward.value,
              });
              return;
            }
            const backward = scoped[targetIndex - offset];
            if (backward && !backward.disabled) {
              updatePickerValue({
                category: selectedCategory,
                gender: selectedGender,
                number: backward.value,
              });
              return;
            }
          }
        }
        updatePickerValue({
          category: selectedCategory,
          gender: selectedGender,
          number: PLACEHOLDER_VALUE,
        });
        return;
      }
      if (nextOption === selectedNumber) {
        return;
      }
      updatePickerValue({
        category: selectedCategory,
        gender: selectedGender,
        number: nextOption,
      });
    },
    [
      numbersByGroup,
      pickerValue.category,
      pickerValue.gender,
      pickerValue.number,
      updatePickerValue,
      wheelInteractionDisabled,
    ],
  );

  const handleTextInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextValue = normalisePatrolCode(event.target.value);
      if (nextValue) {
        setInputMode('manual');
      }
      onChange(nextValue);
    },
    [onChange],
  );

  useEffect(() => {
    if (inputMode !== 'manual') {
      return;
    }
    const parsed = parsePatrolCodeParts(normalisedValue);
    if (!parsed) {
      return;
    }
    updatePickerValue({
      category: parsed.category,
      gender: parsed.gender,
      number: parsed.number,
    });
  }, [inputMode, normalisedValue, updatePickerValue]);

  useEffect(() => {
    if (inputMode !== 'picker') {
      return;
    }
    const nextCategory = isPlaceholder(pickerValue.category) ? '' : pickerValue.category;
    const nextGender = isPlaceholder(pickerValue.gender) ? '' : pickerValue.gender;
    const nextNumber = isPlaceholder(pickerValue.number) ? '' : pickerValue.number;

    let nextManual = '';
    if (nextCategory) {
      nextManual = nextCategory;
      if (nextGender) {
        nextManual += nextGender;
        if (nextNumber) {
          nextManual += `-${nextNumber}`;
        } else {
          nextManual += '-';
        }
      }
    }

    if (nextManual !== normalisedValue) {
      onChange(nextManual);
    }
  }, [inputMode, normalisedValue, onChange, pickerValue.category, pickerValue.gender, pickerValue.number]);

  return (
    <div className="patrol-code-input">
      {label ? (
        <span className="patrol-code-input__label" id={labelId}>
          {label}
        </span>
      ) : null}
      <div className="patrol-code-input__text">
        <label htmlFor={textInputId}>Zadání z klávesnice</label>
        <input
          id={textInputId}
          type="text"
          inputMode="text"
          autoComplete="off"
          placeholder="Např. RH-01"
          value={textInputValue}
          onChange={handleTextInputChange}
          onFocus={() => setIsInputFocused(true)}
          onBlur={() => setIsInputFocused(false)}
          aria-describedby={`${textHintId}${validationState.message ? ` ${feedbackId}` : ''}`}
          aria-invalid={validationState.reason === 'format' ? true : undefined}
        />
        <small id={textHintId}>Formát: N/M/S/R + H/D + číslo 01–40.</small>
      </div>
      {showWheel ? (
        <>
          <div className="patrol-code-input__wheel-headings" aria-hidden="true">
            <span>Kategorie</span>
            <span>Pohlaví</span>
            <span>Číslo hlídky</span>
          </div>
          <div
            className={`patrol-code-input__wheel-group${wheelIsDisabled ? ' is-disabled' : ''}`}
            role="group"
            aria-labelledby={labelId}
            onWheelCapture={
              isInputFocused
                ? (event) => {
                  event.preventDefault();
                }
                : undefined
            }
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
        </>
      ) : null}
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
