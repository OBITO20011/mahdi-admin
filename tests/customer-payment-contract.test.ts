import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {assertCustomerCollectionRequest,assertCustomerCollectionResult,captureCustomerCollectionRequest,
  canonicalPaymentMoney,customerCollectionPostgresText,fingerprintCustomerCollectionRequest,
  parseCustomerPaymentAmount} from '../src/services/supabase/customerPaymentContract';

const input = () => ({actorId:randomUUID(),orderId:randomUUID(),idempotencyKey:randomUUID(),
  amount:'0.300',method:' CliQ ',reference:' R-1 ',notes:' notes '});
const fixture = async () => {
  const request = captureCustomerCollectionRequest(input());
  const fingerprint = await fingerprintCustomerCollectionRequest(request);
  return {request,fingerprint,result:{...request,contractVersion:'phase5-customer-collection-result-v2',
    kind:'COMMITTED_COLLECTION',success:true,request,requestFingerprint:fingerprint,
    operationId:randomUUID(),originalPaymentId:randomUUID(),collectionId:randomUUID(),paymentNumber:'CRV-TEST',
    outstandingBeforeInMinorUnits:'1000',outstandingAfterInMinorUnits:'700'}};
};

test('payment exact decimal parsing never rounds or uses unsafe Number money', () => {
  for (const [raw,minor] of [['0.001','1'],['0.3','300'],['1','1000'],[' 2.345 ','2345'],
    ['9223372036854775.807','9223372036854775807']]) assert.equal(parseCustomerPaymentAmount(raw),minor);
  for (const raw of [null,undefined,1,{},[],true,'0','-1','+1','1.0001','1e3','01','1.',
    '.1','NaN','Infinity','9223372036854775.808']) assert.throws(() => parseCustomerPaymentAmount(raw));
  for (const value of [null,0,1,{},[],'01','-1','1.0','+1','9223372036854775808']) {
    assert.throws(() => canonicalPaymentMoney(value));
  }
  assert.equal(canonicalPaymentMoney('0'),0n);
});

test('request is copied and frozen synchronously before an async wait', async () => {
  const raw = input(); const request = captureCustomerCollectionRequest(raw);
  const digest = fingerprintCustomerCollectionRequest(request);
  raw.amount='99'; raw.reference='edited'; raw.method='card'; raw.orderId=randomUUID();
  assert.equal(request.amountInMinorUnits,'300'); assert.equal(request.tenderReference,'R-1');
  assert.equal(request.tenderMethod,'cliq'); assert.notEqual(request.orderId,raw.orderId);
  assert.ok(Object.isFrozen(request));
  assert.equal(await digest,createHash('sha256').update(customerCollectionPostgresText(request)).digest('hex').toUpperCase());
});

test('all request keys/types are mandatory and only new Cash/CliQ requests are admitted', () => {
  const request = captureCustomerCollectionRequest(input());
  for (const key of Object.keys(request)) {
    const missing: Record<string,unknown> = {...request}; delete missing[key];
    assert.throws(() => assertCustomerCollectionRequest(missing));
    const nullable = {...request,[key]:null};
    if (key === 'notes') assertCustomerCollectionRequest(nullable);
    else assert.throws(() => assertCustomerCollectionRequest(nullable));
  }
  for (const change of [{amountInMinorUnits:300},{amountInMinorUnits:'0'},{tenderMethod:'card'},
    {tenderReference:''},{tenderReference:'x'.repeat(121)},{actorId:null},{idempotencyKey:' '},
    {notes:'\0'},{extra:1}]) assert.throws(() => assertCustomerCollectionRequest({...request,...change}));
  const cash = {...request,tenderMethod:'cash',tenderReference:null,notes:null};
  assertCustomerCollectionRequest(cash);
});

test('result validation rejects every missing/NULL identity and impossible financial allocation', async () => {
  const {request,fingerprint,result} = await fixture();
  assertCustomerCollectionResult(request,fingerprint,result);
  for (const key of Object.keys(result)) {
    const missing: Record<string,unknown> = {...result}; delete missing[key];
    assert.throws(() => assertCustomerCollectionResult(request,fingerprint,missing));
    assert.throws(() => assertCustomerCollectionResult(request,fingerprint,{...result,[key]:null}));
  }
  for (const change of [{success:false},{kind:'HISTORICAL_RECEIPT_ONLY'},{kind:'UNSUPPORTED'},
    {actorId:randomUUID()},{orderId:randomUUID()},{idempotencyKey:randomUUID()},
    {requestFingerprint:'A'.repeat(64)},{request:{...request,amountInMinorUnits:'900'}},
    {amountInMinorUnits:'900'},{outstandingBeforeInMinorUnits:'200'},
    {outstandingAfterInMinorUnits:'701'},{outstandingAfterInMinorUnits:-1},
    {outstandingAfterInMinorUnits:'9223372036854775808'},
    {operationId:null},{collectionId:'abc'},{originalPaymentId:1},
    {tenderReference:'wrong'},{paymentNumber:''},{replay:true}]) {
    assert.throws(() => assertCustomerCollectionResult(request,fingerprint,{...result,...change}));
  }
});

test('pure protocol preparation is not wired into current payment mutation or UI', () => {
  for (const file of ['src/services/supabase/customerAccounts.service.ts',
    'src/features/accounts/RecordCustomerPaymentModal.tsx']) {
    const text = readFileSync(file,'utf8');
    assert.doesNotMatch(text,/customerPaymentContract|record_customer_order_payment_v2/u);
  }
});
