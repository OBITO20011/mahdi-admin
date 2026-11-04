import assert from 'node:assert/strict';
import test from 'node:test';
import {createScreenHistory,type ScreenHistoryPort} from '../src/utils/screenHistory';
import type {ActiveTab} from '../src/stores/appStorePreferences';

class FakeHistory implements ScreenHistoryPort {
 entries:unknown[]=[null,null];index=1;exited=false;
 listeners=new Set<(state:unknown)=>void>();
 state=()=>this.entries[this.index];
 push=(state:unknown)=>{this.entries.splice(this.index+1);this.entries.push(structuredClone(state));this.index++;};
 replace=(state:unknown)=>{this.entries[this.index]=structuredClone(state);};
 go=(delta:number)=>{queueMicrotask(()=>{const next=this.index+delta;if(next<0||next>=this.entries.length)return;this.index=next;if(next===0){this.exited=true;return;}for(const listener of this.listeners)listener(this.state());});};
 onPop=(listener:(state:unknown)=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
}
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(initial:ActiveTab='home'){
 const port=new FakeHistory();let tab=initial,layers=0,leave=true,closeAllowed=true,closeCalls=0;
 const visited:ActiveTab[]=[];let visit=(_target:ActiveTab)=>true;
 const screen=createScreenHistory(port,{getTab:()=>tab,navigate:next=>{tab=next;visited.push(next);},beforeLeave:()=>leave,canVisit:next=>visit(next),hasLayer:()=>layers>0,
  closeLayer:()=>{closeCalls++;if(closeAllowed)layers--;screen.reconcile();}});
 return {port,screen,visited,tab:()=>tab,layers:()=>layers,closeCalls:()=>closeCalls,
  navigate(next:ActiveTab){if(screen.request(next))tab=next;},
  setLayers(next:number){layers=next;screen.reconcile();},setLeave(next:boolean){leave=next;},setClose(next:boolean){closeAllowed=next;},setVisit(next:typeof visit){visit=next;}};
}

test('each real tab transition has history; Back/Forward selects screens only and root Back exits normally',async()=>{
 const f=fixture();await settle();
 f.navigate('orders');f.navigate('inventory');assert.equal(f.port.entries.length,4);
 f.port.go(-1);await settle();assert.equal(f.tab(),'orders');
 f.port.go(-1);await settle();assert.equal(f.tab(),'home');
 f.port.go(1);await settle();assert.equal(f.tab(),'orders');
 f.port.go(-1);await settle();f.port.go(-1);await settle();assert.equal(f.port.exited,true);
 assert.deepEqual(f.visited,['orders','home','orders','home']);f.screen.dispose();
});

test('nested dialogs share one sentinel; Back closes only the top; Forward never reconstructs a closed form',async()=>{
 const f=fixture('orders');await settle();const base=f.port.index;
 f.setLayers(2);await settle();assert.equal(f.port.index,base+1);
 f.port.go(-1);await settle();assert.equal(f.layers(),1);assert.equal(f.port.index,base+1);assert.equal(f.closeCalls(),1);assert.equal(f.tab(),'orders');
 f.port.go(-1);await settle();assert.equal(f.layers(),0);assert.equal(f.port.index,base);assert.equal(f.closeCalls(),2);
 f.port.go(1);await settle();assert.equal(f.layers(),0);assert.equal(f.closeCalls(),2);assert.equal(f.tab(),'orders');
 assert.deepEqual(f.visited,[]);f.screen.dispose();
});

test('busy/unsaved dialog refusal keeps the sentinel and current screen; explicit close consumes it once',async()=>{
 const f=fixture('pos');await settle();const base=f.port.index;
 f.setLayers(1);f.setClose(false);await settle();f.port.go(-1);await settle();
 assert.equal(f.layers(),1);assert.equal(f.port.index,base+1);assert.equal(f.closeCalls(),1);assert.equal(f.tab(),'pos');
 f.setLayers(0);await settle();assert.equal(f.port.index,base);assert.equal(f.tab(),'pos');f.screen.dispose();
});

test('declining to leave a cart or a pending attempt restores the entry with no navigation or new operation',async()=>{
 const f=fixture();f.navigate('pos');await settle();const position=f.port.index;
 f.setLeave(false);f.port.go(-1);await settle();assert.equal(f.tab(),'pos');assert.equal(f.port.index,position);assert.deepEqual(f.visited,[]);
 f.navigate('reports');assert.equal(f.tab(),'pos');assert.equal(f.port.index,position);
 f.setLeave(true);f.port.go(-1);await settle();assert.equal(f.tab(),'home');
 f.port.go(1);await settle();assert.equal(f.tab(),'pos');assert.deepEqual(f.visited,['home','pos']);f.screen.dispose();
});

test('initial deep-linked screen has a home predecessor; same tab and StrictMode layer handover add no duplicate',async()=>{
 const f=fixture('cheques');await settle();const count=f.port.entries.length;
 f.navigate('cheques');assert.equal(f.port.entries.length,count);
 f.setLayers(1);f.setLayers(0);await settle();assert.equal(f.port.entries.length,count);
 f.port.go(-1);await settle();assert.equal(f.tab(),'home');f.screen.dispose();
});

test('a tab picked inside a drawer reuses its sentinel and cleanup cannot undo the new destination',async()=>{
 const f=fixture();await settle();f.setLayers(1);await settle();
 f.navigate('reports');f.setLayers(0);await settle();assert.equal(f.tab(),'reports');assert.equal(f.port.index,2);
 f.port.go(-1);await settle();assert.equal(f.tab(),'home');f.screen.dispose();
});

test('role changes use existing destination guard; history contains only tab metadata, never form data',async()=>{
 const f=fixture();f.navigate('users');f.navigate('reports');f.setVisit(next=>next!=='users');
 f.port.go(-1);await settle();assert.equal(f.tab(),'home');
 for(const raw of f.port.entries.slice(1)){
  const entry=(raw as Record<string,unknown>).nawasrahScreenHistory as Record<string,unknown>;
  assert.deepEqual(Object.keys(entry).sort(),['overlay','position','session','tab','version']);
  assert.equal(typeof entry.overlay,'boolean');
 }
 f.screen.dispose();assert.equal(f.port.listeners.size,0);
});
