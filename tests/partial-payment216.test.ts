import test from 'node:test';
import assert from 'node:assert/strict';
import {partialPayment216} from '../src/features/pos/partialPayment216';

test('216 partial payment plans exact minor-unit cash/CliQ and remaining debt without reducing sales', () => {
  for (const method of ['cash', 'cliq'] as const) {
    assert.deepEqual(partialPayment216(100000, 60000, method, 'registered'), {
      paymentMethod: 'debt', paidInMinorUnits: 60000, dueInMinorUnits: 40000, initialPaymentMethod: method,
    });
    const discounted = partialPayment216(90000, 60001, method, 'registered');
    assert.equal(discounted.dueInMinorUnits, 29999);
    assert.equal(discounted.paidInMinorUnits + discounted.dueInMinorUnits, 90000);
  }
});

test('216 zero remains full debt and exact payment becomes an ordinary paid sale', () => {
  assert.deepEqual(partialPayment216(100000, 0, 'cash', 'registered'), {
    paymentMethod: 'debt', paidInMinorUnits: 0, dueInMinorUnits: 100000, initialPaymentMethod: null,
  });
  for (const method of ['cash', 'cliq'] as const) assert.deepEqual(partialPayment216(100000, 100000, method, null), {
    paymentMethod: method, paidInMinorUnits: 100000, dueInMinorUnits: 0, initialPaymentMethod: null,
  });
});

test('216 refuses walk-in debt, overpayment, invalid and unsafe money instead of rounding', () => {
  for (const paid of [0, 60000]) assert.throws(() => partialPayment216(100000, paid, 'cash', null), /زبوناً مسجلاً/);
  for (const [total, paid] of [[100000, -1], [100000, 100001], [0, 0], [100000, 0.5],
    [NaN, 0], [100000, Infinity], [Number.MAX_SAFE_INTEGER + 1, 1]]) {
    assert.throws(() => partialPayment216(total, paid, 'cash', 'registered'), /المدفوع الآن/);
  }
});
