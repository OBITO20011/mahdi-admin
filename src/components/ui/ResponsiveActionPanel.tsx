import React,{useId,useSyncExternalStore} from 'react';
import {ArrowRight} from 'lucide-react';
import {useDialogFocus} from '../../hooks/useDialogFocus';
import {UiButton} from './Controls';

const subscribe=(listener:()=>void)=>{const q=window.matchMedia('(max-width: 1023px)');q.addEventListener('change',listener);return()=>q.removeEventListener('change',listener);};
/** One form instance: desktop side panel,phone full-screen with shared focus stack. */
export function ResponsiveActionPanel({open,onClose,busy,title,backLabel,children,footer}:{open:boolean;onClose:()=>void;busy:boolean;title:string;backLabel:string;children:React.ReactNode;footer:React.ReactNode}) {
  const mobile=useSyncExternalStore(subscribe,()=>window.matchMedia('(max-width: 1023px)').matches,()=>false);
  const modal=mobile&&open,id=useId();
  const focus=useDialogFocus(modal,()=>{if(!busy)onClose();});
  return <aside ref={modal?focus:undefined} role={modal?'dialog':undefined} aria-modal={modal?true:undefined} aria-labelledby={id} aria-busy={busy}
    className={`min-w-0 flex-col border border-nw-border bg-nw-surface text-nw-text ${modal?'fixed inset-0 z-50 flex h-[100dvh]':'hidden lg:flex lg:w-[340px] lg:shrink-0 lg:rounded-2xl'}`}>
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-nw-border p-4"><h2 id={id} className="m-0 text-base font-bold">{title}</h2>
      {modal&&<UiButton disabled={busy} aria-label={backLabel} onClick={onClose}><ArrowRight className="h-4 w-4"/>رجوع</UiButton>}</header>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">{children}</div>
    <footer className="shrink-0 border-t border-nw-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</footer>
  </aside>;
}
