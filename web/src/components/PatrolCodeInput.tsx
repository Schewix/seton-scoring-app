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

export default function PatrolCodeInput({ value, onChange, id, label }: PatrolCodeInputProps) {
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

  const handleCategorySelect = useCallback(
    (option: CategoryOption) => {
      if (option === selectedCategory) {
        return;
      }

      let nextValue = option;

      if (selectedType) {
        nextValue += selectedType;
        nextValue += selectedNumber ? `-${selectedNumber}` : '-';
      } else if (selectedNumber) {
        nextValue += `-${selectedNumber}`;
      }

      onChange(nextValue);
    },
    [onChange, selectedCategory, selectedNumber, selectedType],
  );

  const handleTypeSelect = useCallback(
    (option: TypeOption) => {
      if (!selectedCategory || option === selectedType) {
        return;
      }

      let nextValue = `${selectedCategory}${option}`;
      nextValue += selectedNumber ? `-${selectedNumber}` : '-';

      onChange(nextValue);
    },
    [onChange, selectedCategory, selectedNumber, selectedType],
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
          options={NUMBER_OPTIONS}
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

  const handleScroll = useCallback(() => {
    if (disabled || !wheelRef.current || options.length === 0) {
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
        if (nextOption !== selected) {
          handleOptionSelect(nextOption);
        } else {
          scrollToOption(closestIndex);
        }
      }
    }, 80);
  }, [disabled, handleOptionSelect, options, scrollToOption, selected]);

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
