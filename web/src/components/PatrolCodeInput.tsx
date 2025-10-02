import { useCallback, useEffect, useId, useMemo, useRef } from 'react';

const PATROL_CODE_REGEX = /^[NMSR][HD]-(?:[1-9]|[1-3][0-9]|40)$/;

const CATEGORY_OPTIONS = ['N', 'M', 'S', 'R'] as const;
const TYPE_OPTIONS = ['H', 'D'] as const;
const NUMBER_OPTIONS = Array.from({ length: 40 }, (_, index) => String(index + 1)) as const;

type CategoryOption = (typeof CATEGORY_OPTIONS)[number];
type TypeOption = (typeof TYPE_OPTIONS)[number];

interface PatrolCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  label?: string;
  availableCodes?: readonly string[];
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

  let result = category;

  if (letter) {
    result += letter;
  }

  if (digits) {
    result += `-${digits}`;
  } else if (letter || (trailingHyphen && category)) {
    result += '-';
  }

  return result;
}

export default function PatrolCodeInput({
  value,
  onChange,
  id,
  label,
  availableCodes,
}: PatrolCodeInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const labelId = label ? `${inputId}-label` : undefined;
  const feedbackId = `${inputId}-feedback`;

  const { normalisedValue, selectedCategory, selectedType, selectedNumber } = useMemo(() => {
    const normalised = normalisePatrolCode(value);
    const categoryOption = CATEGORY_OPTIONS.find((option) => normalised.startsWith(option)) ?? '';
    const typeCandidate = normalised.charAt(1);
    const typeOption =
      categoryOption && TYPE_OPTIONS.includes(typeCandidate as TypeOption)
        ? (typeCandidate as TypeOption)
        : '';
    const digitsMatch = normalised.match(/-(\d{1,2})$/);
    const parsedNumber = digitsMatch ? Number.parseInt(digitsMatch[1], 10) : NaN;
    const numberOption = Number.isNaN(parsedNumber) ? '' : String(parsedNumber);

    return {
      normalisedValue: normalised,
      selectedCategory: categoryOption,
      selectedType: typeOption,
      selectedNumber: numberOption,
    };
  }, [value]);

  const availableNumbersByGroup = useMemo(() => {
    if (!availableCodes || availableCodes.length === 0) {
      return null;
    }

    const groups = new Map<string, string[]>();

    availableCodes.forEach((raw) => {
      if (!raw) {
        return;
      }
      const normalised = normalisePatrolCode(raw);
      const match = normalised.match(/^([NMSR])([HD])-(\d{1,2})$/);
      if (!match) {
        return;
      }
      const [, category, type, digits] = match;
      const parsedNumber = Number.parseInt(digits, 10);
      if (!Number.isFinite(parsedNumber)) {
        return;
      }
      const key = `${category}${type}`;
      const bucket = groups.get(key) ?? [];
      const normalizedNumber = String(parsedNumber);
      if (!bucket.includes(normalizedNumber)) {
        bucket.push(normalizedNumber);
      }
      groups.set(key, bucket);
    });

    groups.forEach((numbers, key) => {
      const sorted = numbers
        .slice()
        .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
      groups.set(key, sorted);
    });

    return groups;
  }, [availableCodes]);

  const numberOptions = useMemo(() => {
    if (!availableNumbersByGroup || availableNumbersByGroup.size === 0) {
      return NUMBER_OPTIONS;
    }

    if (selectedCategory && selectedType) {
      const key = `${selectedCategory}${selectedType}`;
      const scoped = availableNumbersByGroup.get(key);
      if (scoped && scoped.length > 0) {
        return scoped as readonly string[];
      }
      return selectedNumber ? ([selectedNumber] as readonly string[]) : ([] as readonly string[]);
    }

    if (selectedCategory) {
      const aggregated = new Set<string>();
      availableNumbersByGroup.forEach((numbers, key) => {
        if (key.startsWith(selectedCategory)) {
          numbers.forEach((n) => aggregated.add(n));
        }
      });
      if (aggregated.size > 0) {
        return Array.from(aggregated).sort(
          (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10),
        ) as readonly string[];
      }
      return selectedNumber ? ([selectedNumber] as readonly string[]) : ([] as readonly string[]);
    }

    return NUMBER_OPTIONS;
  }, [availableNumbersByGroup, selectedCategory, selectedNumber, selectedType]);

  const handleCategorySelect = useCallback(
    (option: CategoryOption) => {
      if (option === selectedCategory) {
        return;
      }

      let nextValue = option;

      if (selectedType) {
        nextValue += selectedType;
        const scopedNumbers = availableNumbersByGroup?.get(`${option}${selectedType}`);
        const nextNumber =
          selectedNumber && scopedNumbers && scopedNumbers.includes(selectedNumber)
            ? selectedNumber
            : scopedNumbers && scopedNumbers.length > 0
              ? scopedNumbers[0]
              : selectedNumber;
        nextValue += nextNumber ? `-${nextNumber}` : '-';
      } else if (selectedNumber) {
        nextValue += `-${selectedNumber}`;
      }

      onChange(nextValue);
    },
    [availableNumbersByGroup, onChange, selectedCategory, selectedNumber, selectedType],
  );

  const handleTypeSelect = useCallback(
    (option: TypeOption) => {
      if (!selectedCategory || option === selectedType) {
        return;
      }

      let nextValue = `${selectedCategory}${option}`;
      const scopedNumbers = availableNumbersByGroup?.get(`${selectedCategory}${option}`);
      const nextNumber =
        selectedNumber && scopedNumbers && scopedNumbers.includes(selectedNumber)
          ? selectedNumber
          : scopedNumbers && scopedNumbers.length > 0
            ? scopedNumbers[0]
            : selectedNumber;
      nextValue += nextNumber ? `-${nextNumber}` : '-';

      onChange(nextValue);
    },
    [availableNumbersByGroup, onChange, selectedCategory, selectedNumber, selectedType],
  );

  const handleNumberSelect = useCallback(
    (option: string) => {
      if (!selectedCategory || !selectedType) {
        return;
      }

      onChange(`${selectedCategory}${selectedType}-${option}`);
    },
    [onChange, selectedCategory, selectedType],
  );

  const isValid = PATROL_CODE_REGEX.test(normalisedValue.trim().toUpperCase());

  const displayValue = normalisedValue || '—';

  return (
    <div className="patrol-code-input">
      {label ? (
        <span className="patrol-code-input__label" id={labelId}>
          {label}
        </span>
      ) : null}
      <div
        className="patrol-code-input__wheel-group"
        role="group"
        aria-labelledby={labelId}
      >
        <WheelColumn
          options={CATEGORY_OPTIONS}
          selected={selectedCategory}
          onSelect={handleCategorySelect}
          ariaLabel="Kategorie hlídky"
        />
        <WheelColumn
          options={TYPE_OPTIONS}
          selected={selectedType}
          onSelect={handleTypeSelect}
          ariaLabel="Družina nebo hlídka"
          disabled={!selectedCategory}
        />
        <WheelColumn
          options={numberOptions}
          selected={selectedNumber}
          onSelect={handleNumberSelect}
          ariaLabel="Číslo hlídky"
          disabled={!selectedCategory || !selectedType}
        />
      </div>
      <div className="patrol-code-input__value" aria-live="polite">
        {displayValue}
      </div>
      <small id={feedbackId} className={isValid ? 'valid' : 'invalid'}>
        {isValid ? 'Kód je platný' : 'Formát: N/M/S/R + H/D + číslo 1–40 (např. NH-5)'}
      </small>
    </div>
  );
}

interface WheelColumnProps<Option extends string> {
  options: readonly Option[];
  selected: Option | '';
  onSelect: (option: Option) => void;
  ariaLabel: string;
  disabled?: boolean;
}

function WheelColumn<Option extends string>({
  options,
  selected,
  onSelect,
  ariaLabel,
  disabled = false,
}: WheelColumnProps<Option>) {
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const scrollTimeoutRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);
  const isInitialRenderRef = useRef(true);
  const lastScrollInfoRef = useRef<{ top: number; timestamp: number; velocity: number }>({
    top: 0,
    timestamp: 0,
    velocity: 0,
  });

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

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current !== null) {
        window.clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

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
    if (behavior === 'auto') {
      programmaticScrollRef.current = false;
    }
  }, []);

  const handleOptionSelect = useCallback(
    (option: Option) => {
      if (disabled) {
        return;
      }
      if (option === selected) {
        const existingIndex = options.indexOf(option);
        if (existingIndex >= 0) {
          scrollToOption(existingIndex);
        }
        return;
      }

      onSelect(option);
      const selectedIndex = options.indexOf(option);
      if (selectedIndex >= 0) {
        scrollToOption(selectedIndex);
      }
    },
    [disabled, onSelect, options, scrollToOption, selected],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
      if (disabled) {
        return;
      }

      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const nextIndex = currentIndex === 0 ? options.length - 1 : currentIndex - 1;
        handleOptionSelect(options[nextIndex]);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        const nextIndex = currentIndex === options.length - 1 ? 0 : currentIndex + 1;
        handleOptionSelect(options[nextIndex]);
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
      const nextOption = options[closestIndex];
      if (nextOption !== selected) {
        handleOptionSelect(nextOption);
      } else {
        scrollToOption(closestIndex);
      }
    }
  }, [handleOptionSelect, options, scrollToOption, selected]);

  const handleScroll = useCallback(() => {
    if (disabled || !wheelRef.current || options.length === 0) {
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
      if (timeSinceLastScroll < 120 && latestVelocity > 0.05) {
        scrollTimeoutRef.current = window.setTimeout(attemptSettle, 80);
        return;
      }

      finalizeScroll();
    };

    scrollTimeoutRef.current = window.setTimeout(attemptSettle, 140);
  }, [disabled, finalizeScroll, options]);

  useEffect(() => {
    if (options.length === 0) {
      return;
    }
    const nextIndex = selected ? options.indexOf(selected) : 0;
    if (nextIndex < 0) {
      return;
    }
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
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      ref={wheelRef}
      onScroll={handleScroll}
    >
      {options.map((option, index) => {
        const isSelected = selected === option;
        const className = [
          'patrol-code-input__wheel-option',
          isSelected ? 'patrol-code-input__wheel-option--selected' : '',
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
            onClick={() => handleOptionSelect(option)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            disabled={disabled}
            ref={registerOptionRef(index)}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
