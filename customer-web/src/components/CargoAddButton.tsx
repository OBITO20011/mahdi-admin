import { Package, ShoppingCart } from 'lucide-react';
import type { ReactNode } from 'react';

interface CargoAddButtonProps {
  onAdd: (button: HTMLButtonElement) => void;
  disabled?: boolean;
  ariaLabel: string;
  compact?: boolean;
  label?: ReactNode;
  trailing?: ReactNode;
  className?: string;
  itemLabel?: string;
}

export function CargoAddButton({
  onAdd,
  disabled = false,
  ariaLabel,
  compact = false,
  label = 'إضافة للسلة',
  trailing,
  className = '',
}: CargoAddButtonProps) {
  return (
    <button
      type="button"
      onClick={(event) => onAdd(event.currentTarget)}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`cargo-add-button relative overflow-hidden transition disabled:cursor-not-allowed ${
        compact
          ? 'grid h-11 w-14 place-items-center rounded-2xl bg-blue-700 text-white shadow-lg shadow-blue-900/20 hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none'
          : 'flex min-w-0 flex-1 items-center justify-between gap-3 rounded-2xl bg-blue-700 px-4 py-3 text-white shadow-lg shadow-blue-900/20 hover:bg-blue-800 disabled:bg-slate-300 disabled:shadow-none'
      } ${className}`}
    >
      <span className={`flex min-w-0 items-center ${compact ? '' : 'gap-2'}`}>
        <span className="cargo-scene relative block h-7 w-12 shrink-0" aria-hidden="true">
          <span className="cargo-track absolute" />
          <Package className="cargo-box-icon absolute h-4 w-4" />
          <ShoppingCart className="cargo-cart-icon absolute h-4 w-4" />
        </span>
        {!compact && (
          <span className="truncate text-xs font-black">{label}</span>
        )}
      </span>
      {!compact && trailing && (
        <span className="shrink-0">{trailing}</span>
      )}
    </button>
  );
}
