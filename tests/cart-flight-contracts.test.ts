import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {sourceBeforeCartFlight,restoreCartFlightHashes} from '../scripts/audit/source-before-cart-flight.mjs';
import {parseSource} from '../scripts/audit/table-access-inventory.mjs';
import {parseServices} from '../scripts/audit/service-access-inventory.mjs';

const baseline='f098f0afaa7b54b052b18d8266f3789d67e8de76';
const hash=(s:string)=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
const previous=(file:string)=>execFileSync('git',['show',baseline+':'+file],{encoding:'utf8',windowsHide:true,maxBuffer:32*1024**2}).replaceAll('\r\n','\n');

test('flight history admits only exact reviewed presentation bytes and preserves unknown mutations',()=>{
 const pins=JSON.parse(readFileSync('scripts/audit/cart-flight-source-pins.json','utf8'));
 assert.equal(pins.baseline,baseline);
 for(const[file,pin]of Object.entries(pins.entries)as[string,{before:string|null;after:string}][]){
  const raw=readFileSync(file,'utf8');assert.equal(hash(raw),pin.after,file);
  assert.equal(sourceBeforeCartFlight(file,raw)?.replaceAll('\r\n','\n')??null,pin.before===null?null:previous(file),file);
  const mutation=raw+'\n// unknown flight mutation';assert.equal(sourceBeforeCartFlight(file,mutation),mutation,file);
 }
 assert.deepEqual(restoreCartFlightHashes([{file:'unknown',sha256:'unknown'}]),[{file:'unknown',sha256:'unknown'}]);
});

test('the lazy decoration introduces no table/RPC/writer and never moves focus or loads an image URL',()=>{
 const file='customer-web/src/utils/cartAdditionAnimation.ts',raw=readFileSync(file,'utf8');
 assert.deepEqual(parseSource(file,raw).entries,[]);assert.deepEqual(parseServices(file,raw).rpc,[]);
 assert.doesNotMatch(raw,/\b(?:fetch|XMLHttpRequest|Image|toDataURL|getImageData|focus)\s*\(/u);
 const app=readFileSync('customer-web/src/App.tsx','utf8');
 assert.match(app,/import\('\.\/utils\/cartAdditionAnimation'\)/u);
 assert.doesNotMatch(app,/import\s+[^\n]+from ['"][^'"]*cartAdditionAnimation/u);
 const button=readFileSync('customer-web/src/components/CargoAddButton.tsx','utf8');
 assert.match(button,/onClick=\{\(event\) => onAdd\(event\.currentTarget\)\}/u);
 assert.doesNotMatch(button,/setTimeout|setInterval|phase !==/u);
});

// Compare real business functions with main, erasing only the explicitly
// reviewed optional DOM argument and decorative calls. No monetary expression,
// storage mutation, guard, toast text or recovery branch may change.
function businessFunctions(raw:string){
 const source=ts.createSourceFile('App.tsx',raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const names=new Set(['addQuantityToCart','addToCart','addBaseUnitToCart','saveParcelBuilder','updateCatalogCartQuantity']);
 const result:Record<string,string>={};const print=ts.createPrinter();
 const transform:ts.TransformerFactory<ts.Node>=context=>root=>{
  const visit:ts.Visitor=node=>{
   if(ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(source)==='showCartAddition')return undefined;
   if(ts.isIfStatement(node)&&ts.isExpressionStatement(node.thenStatement)&&ts.isCallExpression(node.thenStatement.expression)&&node.thenStatement.expression.expression.getText(source)==='showCartAddition')return undefined;
   let next=ts.visitEachChild(node,visit,context);
   if(ts.isArrowFunction(next))next=ts.factory.updateArrowFunction(next,next.modifiers,next.typeParameters,next.parameters.filter(p=>p.name.getText(source)!=='source'),next.type,next.equalsGreaterThanToken,next.body);
   if(ts.isCallExpression(next))next=ts.factory.updateCallExpression(next,next.expression,next.typeArguments,next.arguments.filter(a=>a.getText(source)!=='source'));
   if(ts.isIfStatement(next)&&ts.isBlock(next.thenStatement)&&next.thenStatement.statements.length===1)next=ts.factory.updateIfStatement(next,next.expression,next.thenStatement.statements[0],next.elseStatement);
   return next;
  };return ts.visitNode(root,visit)!;
 };
 const walk=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&names.has(node.name.getText(source))&&node.initializer){const transformed=ts.transform(node.initializer,[transform]);result[node.name.getText(source)]=print.printNode(ts.EmitHint.Unspecified,transformed.transformed[0],source);transformed.dispose();}ts.forEachChild(node,walk);};walk(source);
 assert.equal(Object.keys(result).length,names.size);return result;
}
test('every existing cart writer, amount, stock/recovery guard and message is identical to main',()=>{
 const file='customer-web/src/App.tsx';assert.deepEqual(businessFunctions(readFileSync(file,'utf8')),businessFunctions(previous(file)));
});

test('CI changes only add bounded synthetic evidence upload, with no changed gate, timeout or retry',()=>{
 const block=`      - name: Upload synthetic cart flight evidence
        if: always()
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: cart-flight-chromium-webkit
          path: \${{ runner.temp }}/nawasrah-cart-flight-*/
          retention-days: 7
          if-no-files-found: ignore

`;
 const file='.github/workflows/quality.yml',raw=readFileSync(file,'utf8').replaceAll('\r\n','\n');
 assert.ok(raw.includes(block));assert.equal(raw.replace(block,''),previous(file));
 const command=JSON.parse(readFileSync('package.json','utf8')).scripts.quality;
 assert.equal(command.replace(' && node scripts/testing/run-cart-flight-browser.mjs',''),JSON.parse(previous('package.json')).scripts.quality);
});

test('published local flight evidence binds the actual sources and all six mandatory browser cases',()=>{
 const proof=JSON.parse(readFileSync('docs/operations/STOREFRONT_CART_FLIGHT_LOCAL.json','utf8'));
 assert.equal(proof.ok,true);assert.equal(proof.hostedAccess,false);assert.equal(proof.deployments,0);
 for(const[file,sha]of Object.entries(proof.sourceHashes))assert.equal(hash(readFileSync(file,'utf8')),sha,file);
 assert.deepEqual(proof.browser.map((r:{engine:string;width:number})=>[r.engine,r.width]),[['chromium',360],['chromium',390],['chromium',1440],['webkit',360],['webkit',390],['webkit',1440]]);
 assert.ok(proof.browser.every((r:{max:number;finalQuantity:number;adds:number;firstVisualEndMs:number;endpointMaxErrorPx:number;hiddenTarget:boolean})=>r.max===3&&r.finalQuantity===26&&r.adds<r.firstVisualEndMs&&r.endpointMaxErrorPx<1&&r.hiddenTarget));
 assert.ok(proof.budget.after.initialJsBytes<=proof.budget.before.initialJsBytes);
 assert.ok(proof.budget.after.initialJsGzip<=proof.budget.before.initialJsGzip);
 assert.deepEqual(proof.escapedExternalRequests,[]);
});
