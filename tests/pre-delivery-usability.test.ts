import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {operatorErrorMessage,operatorPosRejectionMessage,type OperatorErrorArea} from '../src/utils/operatorError';
import {knownBusinessErrorMessage,businessErrorMessage} from '../src/utils/businessError';
import {posKnownRejectionCopy} from '../src/utils/posKnownRejectionCopy';
import {rejectionMessages} from '../src/utils/rejectionMessage';
import {runInNewContext} from 'node:vm';
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
  assert.doesNotMatch(read('src/features/orders/AdminAftercarePanel.tsx'),/cause\.message|recoveryError\.message/u);
  assert.ok(read('src/features/orders/AdminAftercarePanel.tsx').includes("operatorErrorMessage('aftercare',result.error)"));
});

test('operator copy has stable short references and no technical exception channel',()=>{
  for(const area of ['products','partial','saleUnknown','saleRejected','inspect','cancel','receipt','aftercare','aftercareRead','parcelEvidence'] as OperatorErrorArea[]){
    const text=operatorErrorMessage(area);assert.match(text,/مرجع: (?:POS|RET)-\d{2}$/u);
    assert.match(text,/[\u0600-\u06ff]/u);assert.ok(text.length<350);
    assert.doesNotMatch(text,/token=|session|0799999999|12345\.678|SQL_INTERNAL|basket=/u);
  }
  assert.match(operatorErrorMessage('saleUnknown'),/استخدم استرجاع المحاولة؛ لا تنشئ بيعاً جديداً/u);
  assert.doesNotMatch(read('src/utils/operatorError.ts'),/localStorage|setTimeout|fetch\(|supabase|randomUUID/u);
});

function literalDictionary(source:string,name:string):Record<string,string>{
  const file=ts.createSourceFile('copy.ts',source,ts.ScriptTarget.Latest,true);
  let result:Record<string,string>|undefined;
  function visit(node:ts.Node){
    if(ts.isVariableDeclaration(node)&&node.name.getText(file)===name&&node.initializer&&ts.isObjectLiteralExpression(node.initializer)){
      result=Object.fromEntries(node.initializer.properties.map(property=>{
        assert.ok(ts.isPropertyAssignment(property));assert.ok(ts.isStringLiteral(property.initializer));
        return[property.name.getText(file).replace(/^['"]|['"]$/gu,''),property.initializer.text];
      }));
    }
    ts.forEachChild(node,visit);
  }visit(file);assert.ok(result,'Checked-in POS dictionary must exist');return result;
}
test('every trusted POS identity keeps the exact service translation with POS04 and no raw-message channel',()=>{
  const approved=literalDictionary(read('src/services/supabase/posV2.service.ts'),'knownErrors');
  assert.deepEqual(posKnownRejectionCopy,approved);
  for(const [identity,copy] of Object.entries(approved))assert.equal(operatorPosRejectionMessage(identity),`${copy} مرجع: POS-04`);
  for(const identity of ['__proto__','constructor','UNKNOWN_CODE','PHASE3_POS_OPEN_SHIFT_REQUIRED: اسم 0799999999']){
    assert.equal(operatorPosRejectionMessage(identity),operatorErrorMessage('saleRejected'));
  }
});
test('aftercare uses known pattern/dictionary translations only;English/raw Arabic/technical values never escape',()=>{
  for(const code of ['PHASE4_RETURN_WINDOW_EXPIRED','AFTERCARE215_REFUND_METHOD_REQUIRED','AFTERCARE215_REFUND_REFERENCE_REQUIRED',...Object.keys(rejectionMessages)]){
    const input=`${code}: اسم خاص 0799999999 12345.678 token=secret`;
    const copy=knownBusinessErrorMessage(input);assert.ok(copy,code);
    assert.equal(operatorErrorMessage('aftercare',input),`${copy} مرجع: RET-01`);
    assert.equal(operatorErrorMessage('aftercareRead',new Error(input)),`${copy} مرجع: RET-02`);
    assert.equal(operatorErrorMessage('aftercare',copy),`${copy} مرجع: RET-01`);
    assert.equal(copy,businessErrorMessage(input));
    assert.doesNotMatch(copy,/0799999999|12345\.678|token=|اسم خاص/u);
  }
  for(const raw of ['SQL_INTERNAL_999: amount=12345.678 token=secret','TypeError: Cannot read property','اسم زبون خاص 0799999999','network failed 0799999999', 'طلب غير صالح <script>secret</script>']){
    assert.equal(operatorErrorMessage('aftercare',new Error(raw)),operatorErrorMessage('aftercare'));
    assert.equal(operatorErrorMessage('aftercareRead',raw),operatorErrorMessage('aftercareRead'));
    assert.equal(operatorErrorMessage('partial',new Error(raw)),operatorErrorMessage('partial'));
    assert.equal(operatorErrorMessage('saleUnknown',raw),operatorErrorMessage('saleUnknown'));
  }
  assert.equal(operatorErrorMessage('aftercare','PHASE4_RETURN_WINDOW_EXPIRED: network detail 0799999999'),
    'انتهت مهلة المرتجع أو الاستبدال الأصلية (48 ساعة). مرجع: RET-01');
});
test('all authored partial-payment validations stay exact and arbitrary suffixes stay hidden',()=>{
  const file=ts.createSourceFile('partial.ts',read('src/features/pos/partialPayment216.ts')+'\n'+read('src/features/pos/PosView.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const literals:string[]=[];
  const visit=(node:ts.Node)=>{
    if(ts.isNewExpression(node)&&node.expression.getText(file)==='Error'&&node.arguments?.[0]&&ts.isStringLiteral(node.arguments[0])){
      const text=node.arguments[0].text;
      if(/المدفوع|دفعة لفاتورة|زبوناً مسجلاً/u.test(text))literals.push(text);
    }ts.forEachChild(node,visit);
  };visit(file);assert.equal(new Set(literals).size,6);
  for(const text of literals){
    assert.equal(operatorErrorMessage('partial',new Error(text)),`${text} مرجع: POS-02`);
    assert.equal(operatorErrorMessage('partial',text+' 0799999999'),operatorErrorMessage('partial'));
  }
});

test('existing businessErrorMessage callers retain their original translations and fallbacks',()=>{
  const before=pins.entries['src/utils/businessError.ts'].beforeText;
  const js=ts.transpileModule(before,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports:{businessErrorMessage?:(value:unknown)=>string}={};
  runInNewContext(js,{exports,require:(name:string)=>{
    assert.equal(name,'./rejectionMessage');return{rejectionMessages};
  }});
  assert.ok(exports.businessErrorMessage);
  const corpus=[null,undefined,'','رسالة تحقق محلية.','SQL_INTERNAL_999: secret','timeout','network failed','permission denied','failed to fetch',
    ...Object.keys(rejectionMessages),...Object.keys(posKnownRejectionCopy),...Object.values(rejectionMessages),
    'PHASE4_RETURN_WINDOW_EXPIRED','AFTERCARE215_REFUND_METHOD_REQUIRED','AFTERCARE215_REFUND_REFERENCE_REQUIRED',
    'AFTERCARE215_PREVIEW_CHANGED','AFTERCARE_OUTCOME_UNKNOWN','PHASE43_RETURN_ALLOCATION_INVALID','OPEN_SHIFT',
    'PHASE4_RETURN_WINDOW_EXPIRED: network detail','IDEMPOTENCY_CONFLICT'];
  for(const input of corpus)assert.equal(businessErrorMessage(input),exports.businessErrorMessage(input),String(input));
});
