import {lazy,useRef} from 'react';
import {MessageCircle} from 'lucide-react';
import {DeferredDialog} from './DeferredDialog';
import type {GuidedStoreAssistantProps} from './GuidedStoreAssistantDialog';

const LazyAssistantDialog=lazy(()=>import('./GuidedStoreAssistantDialog').then(module=>({default:module.GuidedStoreAssistant})));

// The existing trigger is immediate. The unchanged dialog loads only on use;
// DeferredDialog preserves its hidden first commit, focus and mounted state.
export function GuidedStoreAssistant(props:GuidedStoreAssistantProps){
 const {isOpen,showFloatingButton,onOpen,hasCartItems}=props;
 const triggerRef=useRef<HTMLButtonElement>(null);
 return <>
      {showFloatingButton && (
        <button
          type="button"
          ref={triggerRef}
          onClick={() => { triggerRef.current?.focus({preventScroll: true}); onOpen(); }}
          aria-label="فتح مساعد المتجر"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          data-testid="guided-store-assistant-trigger"
          className={`fixed right-4 z-30 grid h-12 w-12 place-items-center rounded-2xl bg-[#0b1b3f] text-amber-200 shadow-xl shadow-slate-950/25 transition hover:-translate-y-0.5 hover:bg-[#132a5d] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-200 md:bottom-6 md:right-6 md:h-14 md:w-14 ${
            hasCartItems ? 'bottom-[9.75rem]' : 'bottom-[5.8rem]'
          }`}
        >
          <MessageCircle className="h-5 w-5 md:h-6 md:w-6" aria-hidden="true" />
          <span className="sr-only">مساعد المتجر</span>
        </button>
      )}
  <DeferredDialog open={isOpen}><LazyAssistantDialog {...props} showFloatingButton={false}/></DeferredDialog>
 </>;
}
