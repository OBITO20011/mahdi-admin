import { Check, Package, ShoppingCart } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type CargoPhase = 'idle' | 'running' | 'done';

interface CargoAddButtonProps {
  onAdd: () => void;
  disabled?: boolean;
  ariaLabel: string;
  compact?: boolean;
  label?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

const CARGO_DROP_DURATION_MS = 680;

export function CargoAddButton({
  onAdd,
  disabled = false,
  ariaLabel,
  compact = false,
  label = 'إضافة للسلة',
  trailing,
  className = '',
}: CargoAddButtonProps) {
  const [phase, setPhase] = useState<CargoPhase>('idle');
  const timersRef = useRef<number[]>([]);

  useEffect(
    () => () => {
      timersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    },
    []
  );

  const handleClick = () => {
    if (disabled || phase !== 'idle') return;

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    if (reducedMotion) {
      onAdd();
      return;
    }

    setPhase('running');
    const addTimer = window.setTimeout(() => {
      onAdd();
      setPhase('done');
    }, CARGO_DROP_DURATION_MS);
    const resetTimer = window.setTimeout(
      () => setPhase('idle'),
      CARGO_DROP_DURATION_MS + 650
    );
    timersRef.current.push(addTimer, resetTimer);
  };

  const statusText =
    phase === 'running'
      ? 'جاري إضافة الطرد...'
      : phase === 'done'
        ? 'تمت الإضافة'
        : label;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || phase !== 'idle'}
      aria-label={ariaLabel}
      data-phase={phase}
      className={`cargo-add-button relative overflow-hidden transition disabled:cursor-not-allowed ${
        compact
          ? 'grid h-11 w-14 place-items-center rounded-2xl bg-blue-700 text-white shadow-lg shadow-blue-900/20 hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none'
          : 'flex min-w-0 flex-1 items-center justify-between gap-3 rounded-2xl bg-blue-700 px-4 py-3 text-white shadow-lg shadow-blue-900/20 hover:bg-blue-800 disabled:bg-slate-300 disabled:shadow-none'
      } ${className}`}
    >
      <span className={`flex min-w-0 items-center ${compact ? '' : 'gap-2'}`}>
        <span className="cargo-scene relative block h-7 w-12 shrink-0" aria-hidden="true">
          {phase === 'done' ? (
            <Check className="cargo-done-icon absolute h-5 w-5" />
          ) : (
            <>
              <span className="cargo-track absolute" />
              <Package className="cargo-box-icon absolute h-4 w-4" />
              <ShoppingCart className="cargo-cart-icon absolute h-4 w-4" />
            </>
          )}
        </span>
        {!compact && (
          <span className="truncate text-xs font-black">{statusText}</span>
        )}
      </span>
      {!compact && phase === 'idle' && trailing && (
        <span className="shrink-0">{trailing}</span>
      )}
      <span className="sr-only" aria-live="polite">
        {phase === 'running'
          ? 'جاري إضافة الطرد إلى السلة'
          : phase === 'done'
            ? 'تمت إضافة الطرد إلى السلة'
            : ''}
      </span>
    </button>
  );
}
