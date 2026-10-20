import {useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {useDialogFocus} from '../../hooks/useDialogFocus';
import {useAppStoreSelector} from '../../stores/useAppStore';
import {useAuthStore} from '../../stores/useAuthStore';
import {UiButton} from '../ui';
import {NavigationDrawerContext,type NavigationDrawerState} from './navigationDrawerContext';
import {SideNav} from './SideNav';
import './navigationDrawer.css';

function MobileNavigationDrawer({onClose}: {onClose: () => void}) {
  const title = useId();
  const panel = useDialogFocus(true, onClose, false, true);
  const backdrop=useRef<HTMLDivElement>(null);
  const pointer = useRef<{x: number; y: number; id: number} | null>(null);
  useLayoutEffect(()=>{
    const overlay=backdrop.current;if(!overlay)return;
    const siblings=Array.from(document.body.children).filter((item):item is HTMLElement=>item instanceof HTMLElement&&item!==overlay);
    const saved=siblings.map(item=>({item,inert:item.inert}));
    const overflow=document.body.style.overflow;
    siblings.forEach(item=>{item.inert=true;});document.body.style.overflow='hidden';
    return()=>{saved.forEach(({item,inert})=>{item.inert=inert;});document.body.style.overflow=overflow;};
  },[]);
  return createPortal(
    <div ref={backdrop} dir="rtl" className="mobile-navigation-backdrop fixed inset-0 z-40 bg-black/60"
      onClick={event => {if (event.target === event.currentTarget) onClose();}}>
      <div ref={panel as React.RefObject<HTMLDivElement>} role="dialog" aria-modal="true"
        aria-labelledby={title} tabIndex={-1} data-mobile-navigation-drawer
        className="mobile-navigation-drawer absolute inset-y-0 right-0 flex w-[min(21rem,90vw)] min-w-0 flex-col bg-nw-side text-nw-side-text shadow-2xl"
        onPointerDown={event => {pointer.current = {x: event.clientX, y: event.clientY, id: event.pointerId};}}
        onPointerCancel={() => {pointer.current = null;}}
        onPointerUp={event => {
          const start = pointer.current; pointer.current = null;
          if (start && start.id === event.pointerId && event.clientX - start.x > 80
            && Math.abs(event.clientY - start.y) < 50) {event.preventDefault();onClose();}
        }}>
        <div className="flex shrink-0 items-center justify-between border-b border-white/15 px-4 py-2">
          <h2 id={title} className="m-0 text-base font-bold">القائمة الرئيسية</h2>
          <UiButton variant="plain" onClick={onClose} aria-label="إغلاق القائمة" className="h-11 w-11 !px-0 text-nw-side-text">
            <X className="h-5 w-5" aria-hidden="true"/>
          </UiButton>
        </div>
        <SideNav mobile/>
      </div>
    </div>, document.body,
  );
}

/** Lives inside IPhoneContainer's unlocked children; locking unmounts this state. */
export function NavigationShell({children}: {children: ReactNode}) {
  const [isOpen, setOpen] = useState(false);
  const [entryIntent,setIntent]=useState<NavigationDrawerState['entryIntent']>(null);
  const intentRequest=useRef(0);
  const setEntryIntent=useCallback((type:'customer_return'|'owner_withdrawals'|null)=>setIntent(type?{type,request:++intentRequest.current}:null),[]);
  const openRef = useRef(false), historyBusy = useRef(false);
  const marker = useId();
  const activeTab = useAppStoreSelector(state => state.activeTab);
  const currentModal = useAppStoreSelector(state => state.currentModal);
  const {user, roleName, roles} = useAuthStore();
  const identity = `${user?.id ?? ''}:${roleName ?? ''}:${roles.join(',')}`;
  const close = useCallback(() => {openRef.current = false; setOpen(false);}, []);
  const open = useCallback(() => {
    if (openRef.current || historyBusy.current || window.matchMedia('(min-width: 1024px)').matches) return;
    openRef.current = true; setOpen(true);
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const before: unknown = window.history.state;
    const state = before && typeof before === 'object' && !Array.isArray(before) ? before : {};
    window.history.pushState({...state, nawasrahNavigationDrawer: marker}, '', window.location.href);
    let ownsEntry = true;
    const back = () => {ownsEntry = false; historyBusy.current = false; close();};
    window.addEventListener('popstate', back);
    return () => {
      window.removeEventListener('popstate', back);
      if (ownsEntry && window.history.state?.nawasrahNavigationDrawer === marker) {
        historyBusy.current = true;
        window.addEventListener('popstate', () => {historyBusy.current = false;}, {once: true});
        window.history.back();
      }
    };
  }, [isOpen, marker, close]);

  useEffect(() => {close();}, [activeTab, currentModal, identity, close]);
  useEffect(()=>{setIntent(null);},[identity]);
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1024px)');
    const changed = () => {if (wide.matches) close();};
    wide.addEventListener('change', changed);
    return () => wide.removeEventListener('change', changed);
  }, [close]);

  return <NavigationDrawerContext.Provider value={{isOpen, open, close,entryIntent,setEntryIntent}}>
    {children}
    {isOpen && <MobileNavigationDrawer onClose={close}/>}
  </NavigationDrawerContext.Provider>;
}
