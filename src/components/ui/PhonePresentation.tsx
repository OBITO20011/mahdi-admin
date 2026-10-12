import React, {createContext, useContext, useId, useState, useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {MoreHorizontal, X} from 'lucide-react';
import {useDialogFocus} from '../../hooks/useDialogFocus';

const subscribePhone = (listener: () => void) => {
  const media = window.matchMedia('(max-width: 1023px)');
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
};
const phoneSnapshot = () => window.matchMedia('(max-width: 1023px)').matches;
const serverSnapshot = () => false;
const usePhone = () => useSyncExternalStore(subscribePhone, phoneSnapshot, serverSnapshot);

type Tab = {value: string; label: string};
const TabsContext = createContext<{
  id: string; options: readonly Tab[]; selected: string; select: (value: string) => void;
} | null>(null);

/** CSS hides inactive phone sections, not unmounting their existing data readers. */
export function MobileTabs({options, defaultValue, children}: {
  options: readonly Tab[]; defaultValue: string; children: React.ReactNode;
}) {
  const id = useId();
  const [selected, select] = useState(defaultValue);
  return <TabsContext.Provider value={{id, options, selected, select}}>{children}</TabsContext.Provider>;
}

export function MobileTabsBar({label}: {label: string}) {
  const tabs = useContext(TabsContext);
  if (!tabs) throw new Error('MobileTabsBar requires MobileTabs');
  return <div role="tablist" aria-label={label} className="flex gap-1 rounded-xl border border-nw-border bg-nw-surface-2 p-1 lg:hidden">
    {tabs.options.map((option, index) => <button key={option.value} type="button" role="tab"
      id={`${tabs.id}-tab-${option.value}`} aria-controls={`${tabs.id}-panel-${option.value}`}
      aria-selected={tabs.selected === option.value} tabIndex={tabs.selected === option.value ? 0 : -1}
      onClick={() => tabs.select(option.value)}
      onKeyDown={event => {
        const direction = event.currentTarget.closest('[dir]')?.getAttribute('dir') ?? document.dir;
        let next: number | null = null;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.options.length - 1;
        if (event.key === 'ArrowRight') next = index + (direction === 'rtl' ? -1 : 1);
        if (event.key === 'ArrowLeft') next = index + (direction === 'rtl' ? 1 : -1);
        if (next === null) return;
        event.preventDefault();
        const selected = tabs.options[(next + tabs.options.length) % tabs.options.length];
        tabs.select(selected.value);
        document.getElementById(`${tabs.id}-tab-${selected.value}`)?.focus();
      }}
      className={`min-h-11 min-w-0 flex-1 rounded-lg px-2 text-xs font-bold ${tabs.selected === option.value ? 'bg-nw-primary text-nw-on-primary' : 'text-nw-muted'}`}>
      {option.label}
    </button>)}
  </div>;
}

export function MobileTabSection({value, primary = true, children}: {
  value: string; primary?: boolean; children: React.ReactNode;
}) {
  const tabs = useContext(TabsContext), phone = usePhone();
  if (!tabs) throw new Error('MobileTabSection requires MobileTabs');
  return <div id={primary ? `${tabs.id}-panel-${value}` : undefined}
    role={phone && primary ? 'tabpanel' : undefined}
    aria-labelledby={phone && primary ? `${tabs.id}-tab-${value}` : undefined}
    tabIndex={phone && primary ? 0 : undefined} data-phone-section={value}
    className={`${tabs.selected === value ? 'block' : 'hidden'} lg:contents`}>
    {children}
  </div>;
}

/** Existing action elements/handlers are passed through unchanged. */
export function MobileActionMenu({label, children}: {label: string; children: React.ReactNode}) {
  const [open, setOpen] = useState(false), phone = usePhone(), id = useId();
  const panel = useDialogFocus(open && phone, () => setOpen(false));
  return <>
    <div className="hidden lg:contents">{children}</div>
    <button type="button" aria-label={label} aria-expanded={open && phone} aria-controls={id}
      onClick={() => setOpen(true)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-nw-border bg-nw-surface text-nw-text lg:hidden">
      <MoreHorizontal className="h-5 w-5" />
    </button>
    {open && phone && createPortal(<div dir="rtl" className="fixed inset-0 z-[70] flex items-end bg-nw-side/80">
      <button type="button" aria-label={`إغلاق ${label}`} onClick={() => setOpen(false)} className="absolute inset-0" />
      <div id={id} ref={panel as React.RefObject<HTMLDivElement>} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}
        tabIndex={-1} className="relative max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border border-nw-border bg-nw-surface p-4 pb-[calc(16px+env(safe-area-inset-bottom))] text-nw-text">
        <div className="mb-3 flex items-center justify-between gap-3"><h2 id={`${id}-title`} className="text-base font-bold">{label}</h2>
          <button type="button" aria-label="رجوع للإجراءات" onClick={() => setOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-xl border border-nw-border"><X className="h-5 w-5" /></button>
        </div>
        <div className="nw-mobile-actions space-y-2" onClick={event => {
          const button = event.target instanceof Element ? event.target.closest('button') : null;
          if (button && !button.disabled) setOpen(false);
        }}>{children}</div>
      </div>
    </div>, document.body)}
  </>;
}
