import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {operatorErrorMessage,type OperatorErrorArea} from '../src/utils/operatorError';
import {sourceBeforeUsability} from '../scripts/audit/source-before-pre-delivery-usability.mjs';

const pins=JSON.parse(readFileSync('scripts/audit/pre-delivery-usability-source-pins.json','utf8'));
const read=(file:string)=>readFileSync(file,'utf8').replaceAll('\r\n','\n');
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');

test('UI historical projection is exact, bound to merged baseline, and rejects unknown mutations',()=>{
  for(const [file,pin] of Object.entries(pins.entries) as [string,{beforeText:string|null;before:string|null;after:string}][]){
    const source=read(file);assert.equal(hash(source),pin.after,file);
    assert.equal(sourceBeforeUsability(file,source),pin.beforeText,file);
    assert.equal(sourceBeforeUsability(file,source+'\n// unknown change'),source+'\n// unknown change');
    if(pin.beforeText!==null){
      assert.equal(hash(pin.beforeText),pin.before);
      assert.equal(execFileSync('git',['show',pins.baseline+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n'),pin.beforeText);
    }
  }
});

function financialSyntax(source:string){
  const file=ts.createSourceFile('view.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const printer=ts.createPrinter({removeComments:true}),facts:string[]=[];
  const serviceCalls=/^(?:runPosV2Attempt|inspectOrCancelPosV2Attempt|fetchAdminAftercare\w*|recoverAdminAftercare|submitSupplierReplacement|supplierReplacementRecovery|(?:handleOpen|handleClose|handleCancelEmptyShift|handlePreviewFullReversal|handleExecuteFullReversal))$/u;
  const visit=(node:ts.Node)=>{
    if(ts.isCallExpression(node)&&serviceCalls.test(node.expression.getText(file)))facts.push(printer.printNode(ts.EmitHint.Unspecified,node,file));
    if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='request')facts.push(printer.printNode(ts.EmitHint.Unspecified,node,file));
    if(ts.isVariableDeclaration(node)&&/^handle(?:Open|Close|CancelEmptyShift|PreviewFullReversal|ExecuteFullReversal)$/u.test(node.name.getText(file)))facts.push(printer.printNode(ts.EmitHint.Unspecified,node,file));
    ts.forEachChild(node,visit);
  };visit(file);return facts;
}
test('financial request, recovery calls, shift handlers and role guards retain the approved contracts',()=>{
  for(const file of ['src/features/pos/PosView.tsx','src/features/shifts/ShiftsView.tsx','src/features/orders/AdminAftercarePanel.tsx']){
    const before=pins.entries[file].beforeText,after=read(file);
    assert.ok(financialSyntax(before).length>0);assert.deepEqual(financialSyntax(after),financialSyntax(before),file);
    assert.equal((after.match(/isOwner &&/gu)||[]).length,(before.match(/isOwner &&/gu)||[]).length,file);
  }
  const pos=read('src/features/pos/PosView.tsx');
  assert.ok(pos.includes("label: 'دين / دفع جزئي'"));
  assert.ok(pos.includes("paymentMethod==='debt'"));
  assert.doesNotMatch(pos,/error\.message|linkError\.message/u);
  assert.doesNotMatch(read('src/features/orders/AdminAftercarePanel.tsx'),/cause\.message|recoveryError\.message|result\.error/u);
});

test('operator copy has stable short references and no technical exception channel',()=>{
  for(const area of ['products','partial','saleUnknown','saleRejected','inspect','cancel','receipt','aftercare','aftercareRead','parcelEvidence'] as OperatorErrorArea[]){
    const text=operatorErrorMessage(area);assert.match(text,/مرجع: (?:POS|RET)-\d{2}$/u);
    assert.match(text,/[\u0600-\u06ff]/u);assert.ok(text.length<350);
    assert.doesNotMatch(text,/token=|session|0799999999|12345\.678|SQL_INTERNAL|basket=/u);
  }
  assert.match(operatorErrorMessage('saleUnknown'),/استخدم استرجاع المحاولة؛ لا تنشئ بيعاً جديداً/u);
  assert.doesNotMatch(read('src/utils/operatorError.ts'),/\.message|localStorage|setTimeout|fetch\(|supabase|randomUUID/u);
});
