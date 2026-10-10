import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {DataTable,Th,Tr,Td,FormFields} from '../src/components/ui';
const baseline=[
  {
    "file": "src/features/purchases/CreatePurchaseOrderModal.tsx",
    "calls": 11,
    "callHash": "930166cefb6b854dbdbbe2252a2bae53483bdc81996a3d164d29b98ff73a79cd",
    "bindings": 24,
    "bindingHash": "bbe82f08b8c2e42a5a3209f7c8ffd79231e83ff7c9a6d4f548ebd36022967f2e",
    "native": 48,
    "nativeHash": "1dd708dcb3fcab68792a21579047f1fa57b1393bd44a6ea07242d964f8a9cb24",
    "functionHash": "53bdf511e607f193181b864991884db6bf3e82a5d23c746689d682aba29a84f2"
  },
  {
    "file": "src/features/purchases/CreateSupplierModal.tsx",
    "calls": 4,
    "callHash": "057eaff5be4ac01130ca323168dbe7f892c405003f30f275864b0796564cd64a",
    "bindings": 12,
    "bindingHash": "9445d65d68b963144a12fa23f6bf987c59803cc0aac71e65540d291ddcdf6bf8",
    "native": 24,
    "nativeHash": "bcc7a4e313d41c548061065c64f0d44486e9f041d20d62a4367f3499b486adb9",
    "functionHash": "e71b947b9417339d7bdd95ba7b0c8350eb384a24fcd24ed94e8cd3a7444a4a70"
  },
  {
    "file": "src/features/purchases/PurchaseOrderCard.tsx",
    "calls": 0,
    "callHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    "bindings": 4,
    "bindingHash": "f872bad0e70efa618255e42740c4ffe2644089e666d85028695ce3d54b7f72fd",
    "native": 2,
    "nativeHash": "4f1b96411d3f9c7058c1365d2f4d9b1ecc7ba530d88a63d164074dd1330aacbc",
    "functionHash": "02d143111e96e2b5b5725f6aeb997cf72b1698b9b5b2a04180779d1ea3cf111f"
  },
  {
    "file": "src/features/purchases/PurchaseOrderDetailView.tsx",
    "calls": 10,
    "callHash": "656344631fbb2b071e713c5697b8d7e787f43d384592de8717ae424de8d2f016",
    "bindings": 25,
    "bindingHash": "612d39818152d9757a8d4a7082e26bf0a227e39128a5e12c07af88776b89b264",
    "native": 24,
    "nativeHash": "5620b05d902e2f5709acc1aedf2d733f6056b44534f2e40da9c12fb3b501c200",
    "functionHash": "c3e3a82171bff834a9f71aefca67e51f01d83f7306f64611e4b14779ec3f397a"
  },
  {
    "file": "src/features/purchases/PurchasesView.tsx",
    "calls": 7,
    "callHash": "ac21504bdc3862120cf579d77ad2e3484bfd3c7f7dae7cb9fe7c380e01b1d77b",
    "bindings": 55,
    "bindingHash": "0f75037f9b1af2caefe3a4a2a63700b2522f379f91a1867e6f478a805ffdb868",
    "native": 59,
    "nativeHash": "1ae65ad740026e9dc1fa496f2a00cb57947878c7cfef358966a738c5f5391aa6",
    "functionHash": "fbbd960f536bd21d50257dc3fdae9c385cd7e319a543823b4393dbb02d7855a5"
  },
  {
    "file": "src/features/purchases/ReceiveGoodsModal.tsx",
    "calls": 2,
    "callHash": "135a5af92ee8d5c25c575c7c54012fa67d06de49598194e4213947a715fbbce0",
    "bindings": 8,
    "bindingHash": "c725ec273352e1db250968cc00ca5983508fc5a82b2c9a2cf622948fa6221b92",
    "native": 22,
    "nativeHash": "2b6abc6801a2bffbfe1c220f3b3d3554f8281a6731a1b4b467f8dd6a8bd4307f",
    "functionHash": "580157318052579bec202a1b89c735bf62f7d79b145832ff5454a9bcf9f2adf0"
  },
  {
    "file": "src/features/purchases/SupplierPaymentModal.tsx",
    "calls": 7,
    "callHash": "e8ff5399effc0614bee4cba872c5a650b22ef8f07bc6aee03a595c3665ff46f6",
    "bindings": 11,
    "bindingHash": "953f20b312a7d05c81f31f6c48c0a616bbfd034d6db7f51c7ac9930c3838d72c",
    "native": 31,
    "nativeHash": "e8f6c417690e267c64859a5634551969a2986b8dab25529c9414f9044297572d",
    "functionHash": "06e1ed13363e92f3f9e806b43443fe21d677fbd8f05ac3ea226c18130c5a0a16"
  },
  {
    "file": "src/features/directReceiving/CancelSupplierReceiptDialog.tsx",
    "calls": 8,
    "callHash": "3c80545629ac74648dc082982823661161fe98b7a233ee78497e7ad8e35195c4",
    "bindings": 4,
    "bindingHash": "6cf285fa87b2cd66203da3dfe69678817e4be6f6562e98e50b8861c334590ac7",
    "native": 7,
    "nativeHash": "58b766a8eeb6c1d4b4071db400ac9067f8f6d980af32d1966ecc26ce4a8939e7",
    "functionHash": "49c64c09520dd189ac66d96bcd5f461fb0db9f50b3b8dbad7842b45ff9cc378a"
  },
  {
    "file": "src/features/directReceiving/CreateDirectReceiptModal.tsx",
    "calls": 16,
    "callHash": "673011b4b7961ce86fc4d7a53455bf959234057dfcb422ed569fac6edd0fe479",
    "bindings": 34,
    "bindingHash": "e9d5438a1eaf1680ef284752c0f083947f3099e218b65502571c69b423464d7e",
    "native": 69,
    "nativeHash": "71056681d270d6a9f7799cb9777ddf4d7d3fa39e6c02b4d08e4c902593bcc579",
    "functionHash": "c1887234ec1cd365fa56d542fdb558333990bbc9a4114b49b855357da65c6e25"
  },
  {
    "file": "src/features/directReceiving/DirectReceivingView.tsx",
    "calls": 10,
    "callHash": "ea2505ae474023fd7850ec265ac6345fde3a805e73d54c046e65147d04cb72f0",
    "bindings": 38,
    "bindingHash": "f1161899ec14948f509e6144ebff9453a5588064d8231ad070990c18d494205a",
    "native": 29,
    "nativeHash": "a8bcaea90aea996f62424ca979c652a612345b0a46cb341139cb49c5ba5f1f4e",
    "functionHash": "85e9f73958ab86968d343dbc9acf998bd86e74c510c676eda59e383d22b54639"
  },
  {
    "file": "src/features/directReceiving/RecordSupplierPaymentModal.tsx",
    "calls": 2,
    "callHash": "4f9897af7fb570b0ff3f7d619b4d47586ef52f377d60ec4de2b2af33ed2007da",
    "bindings": 8,
    "bindingHash": "5429f23e8cbcc80ce25377cac933ebace103c56c3c680c9099a3f98b3a325c28",
    "native": 17,
    "nativeHash": "21e672ad060e2d93bea4dcc7bc912700c654e21ed0684ebcda620db3f6d1a354",
    "functionHash": "a25424acf9f7eea79966b7f7daab004cb36316d51b2e982f82d4493427a6d5ad"
  },
  {
    "file": "src/features/directReceiving/SupplierReceiptDetailView.tsx",
    "calls": 2,
    "callHash": "bd32eb103b5c1d07b3c738d6cc08e93299aa17314f585aa859f366ae30c62019",
    "bindings": 9,
    "bindingHash": "6b2bb580bc829a263e9f74564d25da9ef38896b2a56e598c05bbafe920403633",
    "native": 8,
    "nativeHash": "bfeea56a971964482dc620066a52aa796b9fb033981d54a25037216438a8f37f",
    "functionHash": "d519f102c72fde6a3129e94f6d517e46456ca7649c7c51b3aa364169b5cfd39e"
  }
];
const snapshotScript="\nconst fs=require('fs'),ts=require('typescript'),c=require('crypto');\nconst files=[...fs.readdirSync('src/features/purchases').filter(n=>n.endsWith('.tsx')).map(n=>'src/features/purchases/'+n),...fs.readdirSync('src/features/directReceiving').filter(n=>n.endsWith('.tsx')).map(n=>'src/features/directReceiving/'+n)];\nconst printer=ts.createPrinter({removeComments:true}),hash=v=>c.createHash('sha256').update(JSON.stringify(v)).digest('hex');\n\nfunction snapshot(file){\nconst ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),calls=[],bindings=[],native=[],functions=[];\nconst print=n=>printer.printNode(ts.EmitHint.Unspecified,n,ast);\nconst hasJsx=n=>{let yes=false;function v(p){if(ts.isJsxElement(p)||ts.isJsxSelfClosingElement(p)||ts.isJsxFragment(p)){yes=true;return;}ts.forEachChild(p,v)}v(n);return yes;};\nfunction v(n){\nif(ts.isAwaitExpression(n)||ts.isCallExpression(n)&&/(?:FromSupabase|InSupabase|Service|\\.rpc$|^run[A-Z]|^openModal$|^fetch[A-Z]|^previewSupplierReceiptCancellation$)/u.test(n.expression.getText(ast)))calls.push(print(n));\nif(ts.isJsxAttribute(n)&&/^on[A-Z]/u.test(n.name.getText(ast))&&n.initializer)bindings.push(print(n));\nif(ts.isJsxAttribute(n)&&/^(value|checked|disabled|required|readOnly|inputMode|autoComplete|min|max|step|pattern|aria-busy|data-unsaved)$/u.test(n.name.getText(ast)))native.push(print(n));\nif((ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n))){\nconst tag=n.tagName.getText(ast),type=n.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.getText(ast)==='type');\nif(tag==='button'||tag==='UiButton'){\nlet inForm=false;for(let p=n.parent;p;p=p.parent)if(ts.isJsxElement(p)&&p.openingElement.tagName.getText(ast)==='form'){inForm=true;break;}\nnative.push('button-effective-type:'+ (type?type.initializer.getText(ast):JSON.stringify(inForm?'submit':'button')));\n}else if(type)native.push(print(type));\n}\nif((ts.isArrowFunction(n)||ts.isFunctionExpression(n)||ts.isFunctionDeclaration(n))&&n.body&&!hasJsx(n.body)){\n// Pure display colour maps are the only changed non-render functions.\nlet text=print(n);text=text.replace(/(['\"])([^'\"]*(?:bg|text|border)-(?:nw-[\\w-]+|(?:slate|gray|blue|indigo|purple|violet|emerald|green|teal|amber|orange|rose|pink|red|cyan|yellow)-\\d+)[^'\"]*)\\1/g,'\"<presentation-colours>\"');\nfunctions.push(text);\n}ts.forEachChild(n,v);}v(ast);\nreturn {file,calls:calls.length,callHash:hash(calls.sort()),bindings:bindings.length,bindingHash:hash(bindings.sort()),native:native.length,nativeHash:hash(native.sort()),functionHash:hash(functions.sort())};\n}\nconsole.log(JSON.stringify(files.map(snapshot)));\n";
test('batch3 exact financial calls/payloads,events,validation,confirmation and effective button semantics match a7d2a70',()=>{
 assert.deepEqual(JSON.parse(execFileSync(process.execPath,['-e',snapshotScript],{encoding:'utf8'})),baseline);
});
test('all twelve purchasing screens use tokens/shared forms and buttons',()=>{
 for(const row of baseline){const s=readFileSync(row.file,'utf8');assert.doesNotMatch(s,/(?:bg|text|border|ring|from|via|to)-(?:slate|gray|blue|indigo|purple|violet|emerald|green|teal|amber|orange|rose|pink|red|cyan|yellow)-\d/u,row.file);assert.match(s,/UiButton/u);}
 assert.match(readFileSync('src/components/ui/FormFields.tsx','utf8'),/forwardRef/u);
 assert.match(readFileSync('src/components/ui/TableShell.tsx','utf8'),/overflow-x-auto/u);
});

test('purchase list wiring changes exactly the approved dialog props;typed signatures cannot degrade to React.FC',()=>{
 const file='src/features/purchases/PurchasesView.tsx',s=readFileSync(file,'utf8');
 const ast=ts.createSourceFile(file,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),props:Record<string,string[]>={};
 function visit(n:ts.Node){if(ts.isJsxSelfClosingElement(n)&&['ReceiveGoodsModal','SupplierPaymentModal'].includes(n.tagName.getText(ast)))props[n.tagName.getText(ast)]=n.attributes.properties.map(a=>a.getText(ast));ts.forEachChild(n,visit);}
 visit(ast);
 assert.match(props.ReceiveGoodsModal[0],/^isOpen=\{Boolean\(selectedPoForReceive\)\}$/u);
 assert.match(props.SupplierPaymentModal[0],/^isOpen=\{Boolean\(selectedPoForPayment \|\| isGeneralPaymentModalOpen\)\}$/u);
 assert.match(props.SupplierPaymentModal[2],/^supplierId=\{preselectedSupplierForPayment\?\.id\}$/u);
 for(const name of ['ReceiveGoodsModal','SupplierPaymentModal']){
  const source=readFileSync(`src/features/purchases/${name}.tsx`,'utf8');
  assert.match(source,new RegExp('}: '+name+'Props\\) =>'));
  assert.doesNotMatch(source,new RegExp('export const '+name+': React\\.FC'));
 }
});

test('shared native table/form composition preserves field values,constraints and accessible scrolling',()=>{
 const table=renderToStaticMarkup(React.createElement(DataTable,{caption:'سند الاختبار','data-probe':'table'},
  React.createElement('thead',null,React.createElement(Tr,null,React.createElement(Th,null,'الكمية'))),
  React.createElement('tbody',null,React.createElement(Tr,null,React.createElement(Td,null,
   React.createElement('input',{type:'number',defaultValue:2,min:0,max:36,step:1,required:true,'aria-label':'كمية'}))))));
 assert.match(table,/tabindex="0" role="region" aria-label="سند الاختبار"/u);
 assert.match(table,/<caption class="sr-only">سند الاختبار<\/caption>/u);
 assert.match(table,/data-probe="table"/u);assert.match(table,/min-width:720px/u);
 assert.match(table,/type="number" min="0" max="36" step="1" required="" aria-label="كمية" value="2"/u);
 const form=renderToStaticMarkup(React.createElement(FormFields,{'aria-busy':true,'data-unsaved':'true',role:'dialog'},'محتوى'));
 assert.match(form,/aria-busy="true" data-unsaved="true" role="dialog"/u);
 assert.match(form,/nw-form-fields/u);
});
