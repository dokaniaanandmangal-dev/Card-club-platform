import test from 'node:test';
import assert from 'node:assert/strict';
import { executeFinancialIntegritySettlement } from '../src/financial/financial-integrity-controller.js';
import { computeShadowSettlement } from '../src/financial/settlement-shadow.js';

function fixture() {
  return {
    tenantId: 'club-a',
    tableId: 'table-7',
    handId: 'hand-controller-1',
    epoch: 7,
    outcomeDigest: 'a'.repeat(64),
    participants: [
      { accountId: 'player:alice', openingMinor: '3000', closingMinor: '5000' },
      { accountId: 'player:bob', openingMinor: '7000', closingMinor: '5000' },
    ],
  };
}

test('financial integrity controller emits persistence only after dual verification', async () => {
  let calls = 0;
  const result = await executeFinancialIntegritySettlement(fixture(), {
    fenceToken: '42',
    commit: async command => {
      calls += 1;
      assert.equal(command.verificationScheme, 'dual-v1');
      assert.equal(command.outcomeDigest, 'a'.repeat(64));
      assert.match(command.settlementDigest, /^[0-9a-f]{64}$/);
      assert.equal(command.allocations[0].accountId, 'player:alice');
      assert.equal(command.allocations[0].deltaMinor, '2000');
      assert.equal(command.fenceToken, '42');
      assert.equal(Object.isFrozen(command), true);
      assert.equal(Object.isFrozen(command.allocations), true);
      return { status: 'applied' };
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { status: 'applied' });
});

test('shadow mismatch blocks persistence callback', async () => {
  let calls = 0;
  const maliciousShadow = input => {
    const result = computeShadowSettlement(input);
    return { ...result, allocations: result.allocations.map((row, i) => i === 0 ? { ...row, deltaMinor: '1999' } : row) };
  };
  await assert.rejects(
    executeFinancialIntegritySettlement(fixture(), {
      fenceToken: '42',
      shadow: maliciousShadow,
      commit: async () => { calls += 1; },
    }),
    /shadow_mismatch/,
  );
  assert.equal(calls, 0);
});

test('invalid fencing metadata blocks persistence before settlement commit', async () => {
  let calls = 0;
  await assert.rejects(
    executeFinancialIntegritySettlement(fixture(), {
      fenceToken: '0',
      commit: async () => { calls += 1; },
    }),
    /invalid_fence_token/,
  );
  assert.equal(calls, 0);
});
