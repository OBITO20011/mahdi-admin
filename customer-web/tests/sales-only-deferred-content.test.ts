import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {createElement} from 'react';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {GuidedStoreAssistant} from '../src/components/GuidedStoreAssistant';
const read=(file:string)=>readFileSync(new URL('../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');
const previous=(file:string)=>execFileSync('git',['show','6c80978775805a8d196b1168745b9d8e92fdcf99:customer-web/'+file],{encoding:'utf8',maxBuffer:32*1024**2}).replaceAll('\r\n','\n');
test('assistant dialog content/handlers remain exact; trigger is immediate and lazy dialog uses established focus lifecycle',()=>{
 const original=previous('src/components/GuidedStoreAssistant.tsx'),dialog=read('src/components/GuidedStoreAssistantDialog.tsx'),shell=read('src/components/GuidedStoreAssistant.tsx');
 assert.equal(dialog,original+'\nexport type {GuidedStoreAssistantProps};\n');
 const start=original.indexOf('      {showFloatingButton && ('),end=original.indexOf('\n\n      <div',start);assert.ok(start>0&&end>start);assert.ok(shell.includes(original.slice(start,end).replace('onClick={onOpen}', 'onClick={() => { triggerRef.current?.focus({preventScroll: true}); onOpen(); }}')));
 assert.match(shell,/lazy\(\(\)=>import\('\.\/GuidedStoreAssistantDialog'\)/);
 assert.match(shell,/<DeferredDialog open=\{isOpen\}><LazyAssistantDialog \{\.\.\.props\} showFloatingButton=\{false\}/);
 assert.doesNotMatch(shell,/^import (?!type)[^\n]+from '\.\/GuidedStoreAssistantDialog'/mu);
 const noAction=()=>{throw Error('CLOSED_ASSISTANT_MUST_NOT_INVOKE_ACTIONS');};
 // tsx respects customer-web's preserve JSX setting; provide the classic JSX
 // test runtime without adding an unnecessary production import or global.
 const previousReact=Object.getOwnPropertyDescriptor(globalThis,'React');let html:string;
 try{Object.defineProperty(globalThis,'React',{value:React,configurable:true,writable:true});html=renderToStaticMarkup(createElement(GuidedStoreAssistant,{isOpen:false,showFloatingButton:true,settings:null,whatsappUrl:'',onOpen:noAction,onClose:noAction,onBrowseProducts:noAction,onOpenOffers:noAction,onTrackOrder:noAction,hasCartItems:false}));}
 finally{if(previousReact)Object.defineProperty(globalThis,'React',previousReact);else Reflect.deleteProperty(globalThis,'React');}
 assert.match(html,/guided-store-assistant-trigger/);assert.doesNotMatch(html,/guided-store-assistant-panel|جارٍ تحميل/);
});
test('deferred pages keep existing components and all cart financial/recovery function bodies unchanged',()=>{
 const app=read('src/App.tsx');
 for(const name of ['OffersPage','AboutStorePage']){
  assert.match(app,new RegExp("lazy\\(\\(\\) => import\\('\\./components/"+name+"'\\)"));
  assert.doesNotMatch(app,new RegExp("^import \\{ "+name+" \\} from",'mu'));
  assert.equal(read('src/components/'+name+'.tsx'),previous('src/components/'+name+'.tsx'));
 }
 const bodies=(text:string)=>{const sf=ts.createSourceFile('App.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),out:Record<string,string>={},names=new Set(['addQuantityToCart','addToCart','addBaseUnitToCart','saveParcelBuilder','updateCatalogCartQuantity']);const walk=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.initializer&&names.has(node.name.getText(sf)))out[node.name.getText(sf)]=node.initializer.getText(sf);ts.forEachChild(node,walk);};walk(sf);assert.equal(Object.keys(out).length,5);return out;};
 // Owner12Nov approved only the OFF unit label in the toast. Unwind that
 // single, exact presentation call; every financial/recovery byte stays pinned.
 const actualLabel='storefrontUnitName(product.unitNameAr,product.quantityTracked)',legacyLabel='storefrontUnitName(product.unitNameAr)';
 assert.equal(app.split(actualLabel).length-1,1);
 const reviewed=bodies(app.replace(actualLabel,legacyLabel)),original=bodies(previous('src/App.tsx'));
 assert.deepEqual(reviewed,original);
 assert.notDeepEqual(bodies(app.replace(actualLabel,legacyLabel).replace('quantity: actualQuantity','quantity: actualQuantity + 1')),original,'unknown cart arithmetic remains visible');
});
