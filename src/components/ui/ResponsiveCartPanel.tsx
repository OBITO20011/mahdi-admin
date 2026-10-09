import React, { useId, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { UiButton } from './Controls';

const subscribe = (listener: () => void) => {
  const query = window.matchMedia('(max-width: 1023px)');
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
};
const mobileSnapshot = () => window.matchMedia('(max-width: 1023px)').matches;

/** One cart instance: desktop side panel, below-lg full-screen accessible sheet. */
export function ResponsiveCartPanel({ open, onClose, busy = false, title, action, children, footer }: {
  open: boolean; onClose: () => void; busy?: boolean; title: string;
  action?: React.ReactNode; children: React.ReactNode; footer: React.ReactNode;
}) {
  const titleId = useId();
  const mobile = useSyncExternalStore(subscribe, mobileSnapshot, () => false);
  const modal = mobile && open;
  const focusRef = useDialogFocus(modal, () => { if (!busy) onClose(); });
  return <aside ref={modal ? focusRef : undefined} data-testid="pos-cart-panel"
    role={modal ? 'dialog' : undefined} aria-modal={modal ? true : undefined}
    aria-labelledby={titleId} aria-busy={busy}
    className={`min-w-0 flex-col border border-nw-border bg-nw-surface text-nw-text ${modal
      ? 'fixed inset-0 z-50 flex h-[100dvh] w-full'
      : 'hidden lg:sticky lg:top-4 lg:flex lg:max-h-[calc(100dvh-130px)] lg:w-full lg:rounded-2xl'}`}>
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-nw-border p-4">
      <h2 id={titleId} className="m-0 text-base font-bold">{title}</h2>
      <div className="flex items-center gap-2">{action}{modal && <UiButton disabled={busy} aria-label="رجوع للبيع" onClick={onClose}><X className="h-4 w-4" />رجوع</UiButton>}</div>
    </header>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">{children}</div>
    <footer className="shrink-0 space-y-3 border-t border-nw-border bg-nw-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</footer>
  </aside>;
}
