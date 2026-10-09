/**
 * Package F controls: filter chips, segmented control, search field and
 * the primary/accent/secondary buttons. Touch targets are at least 38–44px.
 */

import React from 'react';
import { Search } from 'lucide-react';

const join = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ');

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

interface FilterChipsProps<T extends string> {
  touchSize?: boolean;
  label: string;
  options: readonly ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** Pill tabs with counters; the selected chip uses the primary token. */
export function FilterChips<T extends string>({ label, options, value, onChange, touchSize = false }: FilterChipsProps<T>) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={join(
              'inline-flex items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold transition',
              touchSize ? 'h-11' : 'h-[38px]',
              selected
                ? 'border-nw-primary bg-nw-primary text-nw-on-primary'
                : 'border-nw-border bg-nw-surface text-nw-text hover:bg-nw-surface-2',
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span
                className={join(
                  'nw-num rounded-full px-[7px] text-xs',
                  selected ? 'bg-white/20' : 'bg-nw-mute-bg',
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface SegmentedControlProps<T extends string> {
  touchSize?: boolean;
  label: string;
  options: readonly ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** Adjacent options in a track (day/week/month, packet/carton/parcel). */
export function SegmentedControl<T extends string>({ label, options, value, onChange, touchSize = false }: SegmentedControlProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-xl border border-nw-border bg-nw-surface-2 p-1">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={join(
              'flex-1 rounded-[9px] px-3 text-[13px] font-semibold transition',
              touchSize ? 'h-11' : 'h-[38px]',
              selected ? 'bg-nw-surface text-nw-text shadow-sm' : 'text-nw-muted hover:text-nw-text',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface SearchFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Visible to screen readers when the placeholder is the only hint. */
  label: string;
  emphasis?: boolean;
}

/** Search input with a leading icon; `emphasis` gives the POS 2px border. */
export const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(
  ({ label, emphasis = false, className, ...rest }, ref) => (
    <label
      className={join(
        'flex h-11 items-center gap-2 rounded-xl bg-nw-surface px-3 text-nw-muted',
        emphasis ? 'border-2 border-nw-primary' : 'border border-nw-border',
        className,
      )}
    >
      <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <input
        ref={ref}
        type="search"
        {...rest}
        className="min-w-0 flex-1 border-0 bg-transparent text-sm text-nw-text outline-none placeholder:text-nw-muted"
      />
    </label>
  ),
);
SearchField.displayName = 'SearchField';

type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'danger';

const buttonVariants: Readonly<Record<ButtonVariant, string>> = {
  primary: 'border-0 bg-nw-primary text-nw-on-primary hover:opacity-95',
  accent: 'border-0 bg-nw-accent text-nw-on-accent hover:brightness-105',
  secondary: 'border border-nw-border bg-nw-surface text-nw-text hover:bg-nw-surface-2',
  danger: 'border border-nw-bad bg-nw-surface text-nw-bad hover:bg-nw-bad-bg',
};

interface UiButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Large = 48px (main action), default = 44px. */
  size?: 'default' | 'large';
}

/**
 * Buttons. `accent` (orange) is reserved for the single most important
 * action on a screen: new sale, complete sale, close shift, record payment.
 */
export const UiButton: React.FC<UiButtonProps> = ({
  variant = 'secondary',
  size = 'default',
  type = 'button',
  className,
  children,
  ...rest
}) => (
  <button
    {...rest}
    type={type}
    className={join(
      'inline-flex items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
      size === 'large' ? 'h-12 text-[15px] font-bold' : 'h-11',
      buttonVariants[variant],
      className,
    )}
  >
    {children}
  </button>
);
