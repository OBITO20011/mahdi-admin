import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {ROLE_LABELS} from '../src/utils/roleLabels';

const baseline=[
  {
    "file": "src/features/products/ProductsView.tsx",
    "calls": 12,
    "callHash": "55eddf18634e6755126645cb7f5b420c490824a1f131db7f93a3c3f1b0107c56",
    "bindings": 26,
    "bindingHash": "0ea0358e7d880ca15b380a3b0a01a958ac7ca3ddf9131447edb421ce8333d526",
    "native": 37,
    "nativeHash": "32bcab6d044903fcadac965d09082b7778460cfcbc28f06209a388cbc7af5bbc",
    "prefixHash": "cc5e8fbe66f53ac3d642d37f62a451fd9725d92ac36c4005a17ce74734999226"
  },
  {
    "file": "src/features/products/ProductDetailModal.tsx",
    "calls": 21,
    "callHash": "1b94d8eea8a293ca6e92ab40f3ef36b2cbff557511a80d4057376beb7938c02b",
    "bindings": 24,
    "bindingHash": "27049d31984b40a617a98149f9781fd5365c2f90c9fc018ca040619fc2891b21",
    "native": 31,
    "nativeHash": "dab47a55cb49cfaeebbb9387d7432dcbb9d3520593c477bde17b84c5bbd8ea5e",
    "prefixHash": "471a3c6d25a95c250e5fed517334620cf51f9e20e0056c2b7c6e1d1d0c7c0c0e"
  },
  {
    "file": "src/features/products/ProductFormModal.tsx",
    "calls": 13,
    "callHash": "3aa8347b9e4a6b2a8a5b068b75edab07aed2be3bbc5f8a6d576f9db498792999",
    "bindings": 36,
    "bindingHash": "ee4d3a4b6bda3d9557bf721c61af6830ac4e605900dcf9c137ddd61b07aaf8f0",
    "native": 84,
    "nativeHash": "2eff202792da44d5c71320006a406a6d9e8425fb8bbc06a7fe0eefd901e72403",
    "prefixHash": "884d89f7c323629f74494bd158f450b7e9620c693602fbefd0b39dfcb8ab9dbf"
  },
  {
    "file": "src/features/products/StockAdjustmentModal.tsx",
    "calls": 1,
    "callHash": "9967ce81a920da5c573939697edbca65da349f48187c6efccc325f0ae35600c9",
    "bindings": 11,
    "bindingHash": "ab16a7ff053ccd1467bba191f8aa053e907951092b7aec64ab29ef56e84b4a93",
    "native": 16,
    "nativeHash": "dfed3849bdc82a6d1955695f7915c5cd785437f2c8251dbad02483e4952d23f8",
    "prefixHash": "27eeffd8ed516dd85505a00209e31ac27bf027c795d2812a05e7d06c7720c746"
  },
  {
    "file": "src/features/more/ParcelConfigurationModal.tsx",
    "calls": 13,
    "callHash": "220a66e419c84686e7d07990474444a4b5472c9525a0b37372d02e6a0d0b4bdd",
    "bindings": 10,
    "bindingHash": "1cbcff8700d07cf60fae88d32feabd8824bd7a88cb0c3d88216b3a72f49d8898",
    "native": 27,
    "nativeHash": "f79d5ffa3bfe25b4dc5f0d9345bb7fe95c226b4204ca8623226fee60a2df95d5",
    "prefixHash": "a34a6236e9396f8200f552f08a6f00614bbbd9dfe35d50a1fba6cb5feec0dfb9"
  },
  {
    "file": "src/features/more/ProfileModal.tsx",
    "calls": 17,
    "callHash": "49705f5cca6f8a4bf3fb8475fc817ff395c2a23df9f624275830d523af3bdaa2",
    "bindings": 37,
    "bindingHash": "18af376073d8158cc703548bf28ea4b13ebaada457733481f8c20a92762f763e",
    "native": 79,
    "nativeHash": "cc6b5b2845c2adc624f4ad6dacdc462fc4cecd7c55085e87d8c4d4464fb842cd",
    "prefixHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
  },
  {
    "file": "src/components/layout/SideNav.tsx",
    "calls": 2,
    "callHash": "ca272316e66045abc88a37d604a8f4c37b33dea339c8b6c4499a14ecf5137b88",
    "bindings": 5,
    "bindingHash": "dec7f7545916c0047bf03c9178cafadc82703f0d6662f07a129e8c045201836f",
    "native": 5,
    "nativeHash": "7280d59b5f0a947c206b69b2bcad674658ee955091dfd444f156e4d5fe8d7844",
    "prefixHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
  }
] as const;
const printer=ts.createPrinter({removeComments:true}),hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
test('batch2:all business calls,payloads,event handlers and native validation/busy values are AST-identical to ed7772f',()=>{
 for(const expected of baseline){
 const ast=ts.createSourceFile(expected.file,readFileSync(expected.file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),calls:string[]=[],bindings:string[]=[],native:string[]=[],prefix:string[]=[];
 const print=(n:ts.Node)=>printer.printNode(ts.EmitHint.Unspecified,n,ast);
 function visit(n:ts.Node){
 if(ts.isAwaitExpression(n)||ts.isCallExpression(n)&&/(?:FromSupabase|InSupabase|Service|\.rpc$|^run[A-Z]|^openModal$|^fetch[A-Z]|^saveParcelConfiguration$|^setParcelFeatureState$)/u.test(n.expression.getText(ast)))calls.push(print(n));
 if(ts.isJsxAttribute(n)&&/^on[A-Z]/u.test(n.name.getText(ast))&&n.initializer)bindings.push(print(n));
 if(ts.isJsxAttribute(n)&&/^(value|checked|disabled|required|readOnly|type|inputMode|autoComplete|min|max|step|pattern|aria-busy|data-unsaved)$/u.test(n.name.getText(ast))){
 const parent=n.parent.parent,tag=(ts.isJsxOpeningElement(parent)||ts.isJsxSelfClosingElement(parent))?parent.tagName.getText(ast):'';
 // Display-only metric text may use Latin/grouped formatting;input values are never excluded.
 if(n.name.getText(ast)!=='value'||!['HeroMetric','Metric','TextMetric','ProfitCard','WholesaleMetric'].includes(tag))native.push(print(n));
 }
 if(ts.isVariableDeclaration(n)&&baseline.slice(0,5).some(p=>p.file.split('/').pop()!.replace('.tsx','')===n.name.getText(ast))&&n.initializer&&ts.isArrowFunction(n.initializer)&&ts.isBlock(n.initializer.body))for(const s of n.initializer.body.statements)if(!ts.isReturnStatement(s))prefix.push(print(s));
 if(ts.isFunctionDeclaration(n)&&n.name?.getText(ast)==='ParcelConfigurationModal'&&n.body)for(const s of n.body.statements)if(!ts.isReturnStatement(s))prefix.push(print(s));
 ts.forEachChild(n,visit);
 }
 visit(ast);assert.equal(calls.length,expected.calls,expected.file);assert.equal(hash(calls.sort()),expected.callHash,expected.file);
 assert.equal(bindings.length,expected.bindings,expected.file);assert.equal(hash(bindings.sort()),expected.bindingHash,expected.file);
 assert.equal(native.length,expected.native,expected.file);assert.equal(hash(native.sort()),expected.nativeHash,expected.file);
 // Entire non-render component prefix includes stock arithmetic,payload construction,guards and confirmations.
 assert.equal(hash(prefix),expected.prefixHash,expected.file);
 }
});
test('batch2 surfaces use semantic tokens/shared controls without changing supplier/cash/DB paths',()=>{
 for(const row of baseline.slice(0,5)){const text=readFileSync(row.file,'utf8');assert.doesNotMatch(text,/(?:bg|text|border|ring|from|via|to)-(?:slate|blue|gray|red|rose|emerald|amber|purple|violet|indigo|cyan|teal)-\d/u,row.file);assert.match(text,/FormFields/u);assert.match(text,/UiButton/u);}
 const stock=readFileSync('src/features/products/StockAdjustmentModal.tsx','utf8');
 assert.match(stock,/aria-busy=\{isSubmitting\}/u);assert.match(stock,/disabled=\{isSubmitting \|\| product.isFlavorMaster\}/u);
 assert.match(stock,/actualQuantity: calculatedNewOnHand/u);assert.match(stock,/finally\s*\{\s*setIsSubmitting\(false\)/u);
});
test('profile and side navigation share the exact Arabic display labels;email stays LTR with full title',()=>{
 assert.deepEqual(ROLE_LABELS,{Owner:'المالك',Admin:'مدير تنفيذي',Accountant:'محاسب',Cashier:'كاشير','Sales Employee':'موظف مبيعات','Warehouse Employee':'مسؤول مستودع','Orders Employee':'متابع الطلبات','Delivery Driver':'سائق توصيل','View Only':'مشاهدة فقط'});
 const source=readFileSync('src/features/more/ProfileModal.tsx','utf8');assert.equal((source.match(/ROLE_LABELS\[currentUser.role\]/gu)||[]).length,2);
 assert.match(source,/data-field="profile-email" dir="ltr" title=\{currentUser.email\} className="truncate/u);
 assert.match(readFileSync('src/components/layout/SideNav.tsx','utf8'),/import \{ROLE_LABELS\} from '..\/..\/utils\/roleLabels'/u);
});
