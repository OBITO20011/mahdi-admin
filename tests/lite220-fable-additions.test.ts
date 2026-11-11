import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{frozen220BeforeDiagnostic}from'../scripts/testing/lite220-owner-frozen-diagnostic.mjs';
import{liteReceivableReaderSource,receivableHunks}from'../scripts/testing/lite220-fable-readers.mjs';import{assertLiteShiftReversalBlock,shiftReversalGuardMessage}from'../src/services/supabase/operatingShiftReversal';import{knownBusinessErrorMessage}from'../src/utils/businessError';import{liteShiftReason}from'../scripts/testing/lite220-fable-additions.mjs';
test('owner SQL Editor diagnostic mirrors 636 frozen rows plus four exact ACLs in one SELECT',()=>{
 const artifact=readFileSync('supabase/migrations/220_sales_only_operating_mode.sql','utf8'),sql=frozen220BeforeDiagnostic(artifact);
 assert.equal(readFileSync('docs/operations/RESET220_BEFORE_D1_READ_ONLY.sql','utf8'),sql);
 assert.equal((sql.match(/^\('/gmu)||[]).length,636);
 assert.equal((sql.match(/\{=X\/postgres,postgres=X\/postgres\}/gu)||[]).length,4);
 const statement=sql.split('\n').filter(line=>!line.startsWith('--')).join('\n').trim();
 assert.match(statement,/^WITH expected\(/u);
 assert.match(statement,/SELECT signature,mismatch_reasons FROM checked\nWHERE cardinality\(mismatch_reasons\)>0\nORDER BY signature;$/u);
 assert.equal((statement.match(/;/gu)||[]).length,1);
 assert.doesNotMatch(statement,/\b(?:BEGIN|ROLLBACK|UPDATE|INSERT|DELETE|GRANT|REVOKE|ALTER|CREATE|DROP)\s/iu);
 for(const reason of['missing_function','source_hash','definition_hash','owner','config','raw_acl'])assert.ok(sql.includes(reason));
 assert.throws(()=>frozen220BeforeDiagnostic('SELECT 1;'));
});
test('parallel readers add only debt-reduction and saved completion hunks;unknown original body rejected',()=>{assert.equal(receivableHunks.length,2);assert.throws(()=>liteReceivableReaderSource({signature:'get_customer_debt_aging(uuid)',source:'UNKNOWN',definition:'UNKNOWN'}),/FABLE_READER_ORIGINAL_BODY_CHANGED/u);assert.throws(()=>liteReceivableReaderSource({signature:'OTHER',source:'UNKNOWN'}),/FABLE_READER_EXACT_SIGNATURE/u);const sql=readFileSync('supabase/migrations/220_sales_only_operating_mode.sql','utf8');for(const name of['get_customer_debt_aging','get_crm_customer_page'])assert.doesNotMatch(sql,new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\('));});
test('new shift block is fail-closed and only known explicit guard texts are translated',()=>{const shift='local',value={success:true,shiftId:shift,canExecute:false,liteShiftBlocked:true,operations:[{operationType:'lite_shift',originalRecordId:shift,status:'BLOCKED',reason:liteShiftReason}]};assert.doesNotThrow(()=>assertLiteShiftReversalBlock(value,shift));for(const patch of[{canExecute:true},{liteShiftBlocked:false},{shiftId:'OTHER'},{operations:[]},{operations:[{...value.operations[0],status:'SUPPORTED'}]}])assert.throws(()=>assertLiteShiftReversalBlock({...value,...patch},shift),/SHIFT-03/u);assert.match(shiftReversalGuardMessage({code:'P0001',message:liteShiftReason})!,/الإلغاء والعكس محجوبان/u);assert.equal(shiftReversalGuardMessage({code:'42501',message:liteShiftReason}),null);assert.match(knownBusinessErrorMessage('LITE3_COLLECTION_REVERSAL_HAS_LITE_REFUND')!,/لا يمكن عكس سند القبض/u);assert.equal(knownBusinessErrorMessage('LITE3_COLLECTION_REVERSAL_HAS_LITE_REFUND SECRET'),null);});
