import assert from 'node:assert/strict';
import test from 'node:test';

import {
  submitPosSaleV2WithRpc,
  type CreatePosSaleV2Input,
  type PosV2RpcExecutor,
} from '../src/services/supabase/posV2.service';

const input: CreatePosSaleV2Input = {
  warehouseId: '11111111-1111-1111-1111-111111111111',
  branchId: '22222222-2222-2222-2222-222222222222',
  paymentMethod: 'cash',
  lines: [{
    commercial_line_kind: 'base_unit',
    product_id: '33333333-3333-3333-3333-333333333333',
    base_quantity: 1,
  }],
  discountInMinorUnits: 0,
  amountReceivedInMinorUnits: 1000,
  idempotencyKey: 'phase3-pos-adapter-key-0001',
};

test('V2 adapter submits one typed RPC request and returns the immutable result', async () => {
  let calls = 0;
  const rpc: PosV2RpcExecutor = async (functionName, parameters) => {
    calls += 1;
    assert.equal(functionName, 'create_pos_sale_v2');
    assert.equal(parameters.p_idempotency_key, input.idempotencyKey);
    assert.deepEqual(parameters.p_lines, input.lines);
    return {
      error: null,
      data: {
        success: true,
        operationId: '44444444-4444-4444-4444-444444444444',
        orderId: '55555555-5555-5555-5555-555555555555',
        orderNumber: 'POS-TEST',
        idempotentReplay: false,
        subtotalInMinorUnits: 1000,
        discountInMinorUnits: 0,
        totalInMinorUnits: 1000,
        amountPaidInMinorUnits: 1000,
        changeDueInMinorUnits: 0,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        items: [],
      },
    };
  };

  const outcome = await submitPosSaleV2WithRpc(input, rpc);
  assert.equal(calls, 1);
  assert.equal(outcome.ok, true);
  if (outcome.ok) assert.equal(outcome.data.orderNumber, 'POS-TEST');
});

test('ambiguous transport failure never retries or rotates the idempotency key', async () => {
  let calls = 0;
  const outcome = await submitPosSaleV2WithRpc(input, async () => {
    calls += 1;
    return { data: null, error: { message: 'network timeout' } };
  });

  assert.equal(calls, 1);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.status, 'unknown');
    assert.equal(outcome.errorIdentity, 'PHASE3_POS_WRITE_OUTCOME_UNKNOWN');
    assert.deepEqual(outcome.recovery, {
      automaticRetry: false,
      reuseOriginalIdempotencyKey: true,
      rotateIdempotencyKey: false,
      verifyOutcomeBeforeRetry: true,
    });
  }
});

test('stable backend conflict is sanitized and does not become an automatic retry', async () => {
  const outcome = await submitPosSaleV2WithRpc(input, async () => ({
    data: null,
    error: {
      code: 'P0001',
      message: 'PHASE3_IDEMPOTENCY_CONFLICT: internal protected detail',
    },
  }));

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.status, 'rejected');
    assert.equal(outcome.errorIdentity, 'PHASE3_IDEMPOTENCY_CONFLICT');
    assert.doesNotMatch(outcome.message, /internal protected detail/u);
    assert.equal(outcome.recovery.automaticRetry, false);
    assert.equal(outcome.recovery.rotateIdempotencyKey, false);
  }
});

test('thrown/invalid responses are treated as unknown outcomes with one call only', async () => {
  let thrownCalls = 0;
  const thrown = await submitPosSaleV2WithRpc(input, async () => {
    thrownCalls += 1;
    throw new Error('fetch failed');
  });
  assert.equal(thrownCalls, 1);
  assert.equal(thrown.ok, false);
  if (!thrown.ok) assert.equal(thrown.status, 'unknown');

  let invalidCalls = 0;
  const invalid = await submitPosSaleV2WithRpc(input, async () => {
    invalidCalls += 1;
    return { data: { success: true }, error: null };
  });
  assert.equal(invalidCalls, 1);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.errorIdentity, 'PHASE3_POS_RESPONSE_INVALID');
});
