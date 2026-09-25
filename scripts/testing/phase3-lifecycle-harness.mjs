import assert from 'node:assert/strict';

// Attach the rejection handler when the contender starts, before awaiting a
// lock barrier. Preserve the complete error for strict assertions afterwards.
export const observeOutcome = (promise) => promise.then(
  (value) => ({ status: 'fulfilled', value }),
  (reason) => ({ status: 'rejected', reason }),
);

export const assertLifecycleRace = ({ results, initialStatus, before, after, cogs }) => {
  // Migration 091/116: expiry is eligible only while still new; completion
  // is eligible only when ready/out_for_delivery. This is not queue priority.
  assert.ok(['new', 'ready', 'out_for_delivery'].includes(initialStatus));
  assert.equal(before.status, initialStatus);
  assert.equal(before.finalized, false);
  assert.equal(before.itemFinalized, false);
  assert.equal(before.reservationState, 'active');
  for (const field of ['movementCount', 'lifecycleOperations', 'terminalHistory',
    'cogs', 'profit', 'revenue', 'paymentRows']) assert.equal(before[field], 0, field);
  const completed = initialStatus !== 'new';
  const winner = completed ? 0 : 1;
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results[winner].status, 'fulfilled');
  assert.equal(results[winner].value.success, true);
  assert.equal(results[winner].value.status, completed ? 'completed' : 'expired');
  assert.equal(results[1 - winner].status, 'rejected');
  assert.match(results[1 - winner].reason.message,
    /ERROR:\s+P0001:\s+PHASE3_CUSTOMER_LIFECYCLE_INVALID:/u);
  assert.equal(after.status, completed ? 'completed' : 'expired');
  assert.equal(before.reservationCount, 1);
  assert.equal(after.reservationCount, 1);
  assert.equal(after.reservationState, completed ? 'consumed' : 'released');
  assert.equal(before.reserved - after.reserved, 1);
  assert.equal(before.onHand - after.onHand, completed ? 1 : 0);
  assert.equal(after.movementCount, completed ? 1 : 0);
  assert.equal(after.movementQuantity, completed ? -1 : 0);
  assert.equal(after.lifecycleOperations, 1);
  assert.equal(after.completions, completed ? 1 : 0);
  assert.equal(after.expiries, completed ? 0 : 1);
  assert.equal(after.terminalHistory, 1);
  assert.equal(after.finalized, completed);
  assert.equal(after.itemFinalized, completed);
  assert.equal(after.cogs, completed ? cogs : 0);
  assert.equal(after.profit, completed ? 1000 - cogs : 0);
  assert.equal(after.revenue, completed ? 1000 : 0);
  assert.equal(after.paymentRows, 0); // Full settlement is recorded on the Order.
  assert.equal(after.paymentStatus, completed ? 'paid' : 'unpaid');
};
