import {VALID_ACTIVE_TABS, type ActiveTab} from '../stores/appStorePreferences';

const key='nawasrahScreenHistory';
interface Entry {version:1;session:string;position:number;tab:ActiveTab;overlay:boolean}
export interface ScreenHistoryPort {
 state:()=>unknown;push:(state:unknown)=>void;replace:(state:unknown)=>void;
 go:(delta:number)=>void;onPop:(listener:(state:unknown)=>void)=>()=>void;
}
interface Options {
 getTab:()=>ActiveTab;navigate:(tab:ActiveTab)=>void;
 beforeLeave:(target:ActiveTab)=>boolean;canVisit:(tab:ActiveTab)=>boolean;
 hasLayer:()=>boolean;closeLayer:()=>void;
 reuseCurrent?:boolean;
}
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};

/** History contains navigation metadata only. It never restores a form or calls an operation. */
export function createScreenHistory(port:ScreenHistoryPort,options:Options) {
 const previous=record(record(port.state())[key]);
 // This is an untrusted UI marker, never an Auth session or authority. Reusing
 // it across StrictMode/remount keeps existing tab history, not any form data.
 const session=options.reuseCurrent&&typeof previous.session==='string'&&/^[A-Za-z0-9.-]{10,100}$/u.test(previous.session)
  ?previous.session:globalThis.crypto?.randomUUID?.()??`ui-${Date.now()}-${Math.random()}`;
 let tab=options.getTab(),position=0,replaying=false,disposed=false,scheduled=false;
 let pending:{position:number;done:()=>void;overlay:boolean}|null=null;
 const read=(raw:unknown):Entry|null=>{
  const entry=record(record(raw)[key]);
  return entry.version===1&&entry.session===session&&Number.isSafeInteger(entry.position)&&Number(entry.position)>=0
   &&Number(entry.position)<=1_000_000&&(VALID_ACTIVE_TABS as readonly unknown[]).includes(entry.tab)&&typeof entry.overlay==='boolean'?entry as unknown as Entry:null;
 };
 const state=(nextTab:ActiveTab,nextPosition:number,overlay=false)=>({...record(port.state()),[key]:{version:1,session,position:nextPosition,tab:nextTab,overlay}});
 const apply=(next:ActiveTab)=>{tab=next;replaying=true;try{options.navigate(next);}finally{replaying=false;}};
 const schedule=()=>{if(scheduled||disposed)return;scheduled=true;queueMicrotask(()=>{scheduled=false;if(!disposed)reconcile();});};
 const restore=(target:number,done:()=>void)=>{
  const current=read(port.state());
  if(current?.position===target){done();schedule();return;}
  pending={position:target,done,overlay:true};
  port.go(target-(current?.position??target-1));
 };
 function reconcile(){
  if(disposed||pending)return;
  const current=read(port.state());
  if(options.hasLayer()){
   if(!current?.overlay){const next=position+1;port.push(state(tab,next,true));position=next;}
  }else if(current?.overlay){
   // A close button and an accepted Back use the same existing dialog cleanup.
   restore(Math.max(0,position-1),()=>{});
  }
 }
 const pop=(raw:unknown)=>{
  if(disposed)return;
  const entry=read(raw);
  if(pending){
   const restoring=pending;
   if(entry&&entry.position!==restoring.position){port.go(restoring.position-entry.position);return;}
   pending=null;position=restoring.position;
   if(!entry)port.replace(state(tab,position,restoring.overlay));
   restoring.done();schedule();return;
  }
  if(options.hasLayer()){
   // Restore our entry before invoking Escape: its busy/unsaved guard may refuse.
   if(!entry){port.replace(state(tab,0));position=1;port.push(state(tab,position,true));options.closeLayer();schedule();}
   else restore(position,options.closeLayer);
   return;
  }
  if(!entry){
   // Same-document state from an earlier app session is never a stored form.
   const allowed=tab==='home'||options.beforeLeave('home');
   port.replace(state('home',0));position=0;
   if(allowed)apply('home');else {position=1;port.push(state(tab,position));}
   return;
  }
  const destination=options.canVisit(entry.tab)?entry.tab:'home';
  if(destination!==tab&&!options.beforeLeave(destination)){restore(position,()=>{});return;}
  position=entry.position;
  if(entry.overlay||entry.tab!==destination)port.replace(state(destination,position));
  if(destination!==tab)apply(destination);
  schedule();
 };
 // An initially restored/deep-linked screen has a real home entry behind it.
 const existing=options.reuseCurrent?read(port.state()):null;
 if(existing){position=existing.position;port.replace(state(tab,position,existing.overlay&&options.hasLayer()));}
 else {port.replace(state('home',0));if(tab!=='home'){position=1;port.push(state(tab,position));}}
 const stop=port.onPop(pop);
 schedule();
 return {
  request(target:ActiveTab){
   if(replaying||disposed)return true;
   if(target===tab)return true;
   if(pending||!options.beforeLeave(target))return false;
   const current=read(port.state());
   // Reuse the drawer's sentinel as the new tab entry, without a ghost form.
   const next=current?.overlay?position:position+1;
   if(current?.overlay)port.replace(state(target,next));else port.push(state(target,next));
   position=next;tab=target;schedule();return true;
  },
  reconcile:schedule,
  busy:()=>pending!==null,
  dispose(){disposed=true;stop();pending=null;const current=read(port.state());if(current?.overlay)port.replace(state(tab,position));},
 };
}

type Controller=ReturnType<typeof createScreenHistory>;
let active:Controller|null=null;
const guards=new Map<symbol,{tab:ActiveTab;allow:()=>boolean}>();
const layers=new Map<symbol,{close:()=>void;top:()=>boolean}>();
export function requestScreenNavigation(tab:ActiveTab){return active?.request(tab)??true;}
export function screenHistoryBusy(){return active?.busy()??false;}
export function registerScreenLeaveGuard(tab:ActiveTab,allow:()=>boolean){
 const id=Symbol();guards.set(id,{tab,allow});return()=>{guards.delete(id);};
}
export function registerBackLayer(close:()=>void,top:()=>boolean){
 const id=Symbol();layers.set(id,{close,top});active?.reconcile();
 return()=>{layers.delete(id);active?.reconcile();};
}
export function installBrowserScreenHistory(getTab:()=>ActiveTab,navigate:(tab:ActiveTab)=>void,canVisit:(tab:ActiveTab)=>boolean){
 active?.dispose();
 // Overlay entries are pushed while the body is fixed. Native restoration would
 // overwrite the modal's saved scroll with that artificial zero on close.
 const scrollRestoration=window.history.scrollRestoration;
 window.history.scrollRestoration='manual';
 const controller=createScreenHistory({
  state:()=>window.history.state,
  push:state=>window.history.pushState(state,'',window.location.href),
  replace:state=>window.history.replaceState(state,'',window.location.href),
  go:delta=>window.history.go(delta),
  onPop:listener=>{const handler=(event:PopStateEvent)=>listener(event.state);window.addEventListener('popstate',handler);return()=>window.removeEventListener('popstate',handler);},
 },{getTab,navigate,canVisit,
  reuseCurrent:true,
  beforeLeave:()=>[...guards.values()].filter(guard=>guard.tab===getTab()).every(guard=>guard.allow()),
  hasLayer:()=>[...layers.values()].some(layer=>layer.top()),
  closeLayer:()=>[...layers.values()].reverse().find(layer=>layer.top())?.close(),
 });
 active=controller;return()=>{controller.dispose();if(active===controller){active=null;window.history.scrollRestoration=scrollRestoration;}};
}
