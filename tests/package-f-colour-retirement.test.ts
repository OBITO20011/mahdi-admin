import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {legacyColourUtility,legacyColourExceptions,nonPresentationColourAst} from '../scripts/testing/package-f-colour-contract.mjs';
import {approvedProductEditConflictSource} from './strict-product-legacy-source';

function filesIn(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?filesIn(`${dir}/${e.name}`):[`${dir}/${e.name}`]);}
test('all src files reject legacy fixed-family utilities; exact exception allowlist is empty',()=>{
 assert.deepEqual(legacyColourExceptions,[]);
 const violations=filesIn('src').flatMap(file=>[...readFileSync(file,'utf8').matchAll(legacyColourUtility)].map(m=>`${file}: ${m[0]}`));
 assert.deepEqual(violations,[]);
 const navigationFixture=readFileSync('e2e/admin-bottom-navigation-harness.tsx','utf8');
 assert.deepEqual([...navigationFixture.matchAll(legacyColourUtility)],[]);
 assert.match(navigationFixture,/bg-nw-bg text-nw-text/u);
 const css=readFileSync('src/index.css','utf8');
 assert.doesNotMatch(css,/html\.theme-light[^{}]*\[class\s*~?=/u);
 assert.doesNotMatch(css,/--admin-|\[class\s*~?=/u);
 assert.match(css,/background:\s*var\(--nw-bg\)/u);
 assert.match(css,/color:\s*var\(--nw-text\)/u);
});
test('guard detects old families in variants,opacity,CSS selectors and palette strings',()=>{
 for(const family of ['slate','blue','emerald','violet','cyan','gray','rose','red','amber','indigo','teal','purple','orange','pink','green','zinc','neutral','stone','yellow','fuchsia','lime'])
  for(const sample of [`hover:bg-${family}-500/20`,`focus:ring-offset-${family}-300`,`html.theme-light [class~="text-${family}-700"]`,`border-l-${family}-800`])
   assert.equal([...sample.matchAll(legacyColourUtility)].length,1,sample);
 assert.deepEqual([..."bg-nw-surface text-nw-ok border-nw-border".matchAll(legacyColourUtility)],[]);
});
const baseline='1272a786583842afac01957287bff72c1b6510c2';
// Only these two wrappers changed by explicit focus decision2026-10-13.
// Whole executable AST remains frozen;their d8bc619 business bodies/forms/calls
// are independently frozen in admin-focus-business-parity.test.ts.
const approvedFocusUIHashes:Record<string,string>={
 'src/features/crm/CustomerEditModal.tsx':'91269b4c71488f25f5da798c3d753f64e04b0ec8bd16bf0960e2321bc5c9fb45',
 'src/features/crm/AddAddressModal.tsx':'c7fbb60d33b9d28b9e35622fcc8c4f24a6f799f02050536da9619693e184065d',
};
const paths=[
 'src/components/common/AppErrorBoundary.tsx','src/components/layout/AdminToast.tsx',
 'src/components/modals/AllModals.tsx','src/components/modals/BrandsModal.tsx','src/components/modals/CategoriesModal.tsx','src/components/modals/UnitsModal.tsx',
 'src/features/barcode/BarcodeCameraCaptureModal.tsx',
 'src/features/crm/AddAddressModal.tsx','src/features/crm/AddCustomerModalContent.tsx','src/features/crm/CustomerEditModal.tsx',
 'src/features/dashboard/ChartsSection.tsx','src/features/dashboard/KpiCards.tsx','src/features/dashboard/QuickActions.tsx','src/features/dashboard/WidgetsSection.tsx',
 'src/features/inventory/ClearInventoryBalanceDialog.tsx','src/features/inventory/InventoryOpeningSetupModal.tsx','src/features/inventory/StockCountModal.tsx','src/features/inventory/WarehouseTransferModal.tsx',
 'src/features/more/adminNavigation.config.ts','src/features/pos/BarcodeScannerModal.tsx','src/features/products/ProductDetailModal.tsx','src/constants/index.ts',
 'e2e/admin-bottom-navigation-harness.tsx',
];
for(const file of paths)test(`batch7 full non-presentation AST parity: ${file}`,()=>{
 const before=execFileSync('git',['show',`${baseline}:${file}`],{encoding:'utf8'});
 // React's inherited setState replaces an erased declare-only annotation.
 // For this file compare the emitted runtime AST, preserving every executable node.
 const source=approvedProductEditConflictSource(file,readFileSync(file,'utf8'));
 if(approvedFocusUIHashes[file]){
  assert.equal(createHash('sha256').update(JSON.stringify(nonPresentationColourAst(file,source))).digest('hex'),approvedFocusUIHashes[file]);
  return;
 }
 const runtime=(text:string)=>ts.transpileModule(text,{compilerOptions:{jsx:ts.JsxEmit.Preserve,target:ts.ScriptTarget.ES2022}}).outputText;
 assert.equal(nonPresentationColourAst(file,file.endsWith('/AppErrorBoundary.tsx')?runtime(source):source),nonPresentationColourAst(file,file.endsWith('/AppErrorBoundary.tsx')?runtime(before):before));
});
test('parity guard still rejects a changed business payload,handler or disabled guard',()=>{
 const file='src/features/inventory/StockCountModal.tsx';
 const before='const View=()=> <button disabled={busy} onClick={() => Service.rpc({quantity:1})} className="bg-slate-900" />;';
 const recoloured=before.replace('bg-slate-900','bg-nw-surface');
 assert.equal(nonPresentationColourAst(file,before),nonPresentationColourAst(file,recoloured));
 for(const changed of [recoloured.replace('quantity:1','quantity:2'),recoloured.replace('disabled={busy}','disabled={false}'),recoloured.replace('Service.rpc','Other.rpc')])
  assert.notEqual(nonPresentationColourAst(file,before),nonPresentationColourAst(file,changed));
});
test('infinite lock pulse is not awaited and remains subject to axe analysis',()=>{
 const helper=readFileSync('e2e/package-f-accessibility.ts','utf8');
 assert.match(helper,/effect\.getTiming\(\)\.iterations!==Infinity/u);
 assert.match(helper,/return finite&&/u);
 assert.match(helper,/return builder\.analyze\(\)/u);
 assert.doesNotMatch(helper,/disableRules|\.exclude\(/u);
});
