import test from 'node:test';
import assert from 'node:assert/strict';
import { executeFinancialIntegritySettlement } from '../src/financial/financial-integrity-controller.js';
import { computeShadowSettlement } from '../src/financial/settlement-shadow.js';

const persistedDigest = 'a'.repeat(64);
function fixture() {
  return {
    tenantId: 'club-a',
    tableId: 'table-7',
    handId: 'hand-controller-1',
    epoch: 7,
    participants: [
      { accountId: 'player:alice', openingMinor: '3000', closingMinor: '5000' },
      { accountId: 'player:bob', openingMinor: '7000', closingMinor: '5000' },
    ],
  };
}
const loadOutcome = async input => ({ ...input, outcomeDigest: persistedDigest });

test('financial integrity controller binds settlement to persisted game outcome before dual verification', async () => {
  let calls = 0;
  const result = await executeFinancialIntegritySettlement(fixture(), {
    fenceToken: '42',
    loadOutcome,
    commit: async command => {
      calls += 1;
      assert.equal(command.verificationScheme, 'dual-v1');
      assert.equal(command.outcomeDigest, persistedDigest);
      assert.match(command.settlementDigest, /^[0-9a-f]{64}$/);
      assert.equal(command.allocations[0].accountId, 'player:alice');
      assert.equal(command.allocations[0].deltaMinor, '2000');
      assert.equal(command.fenceToken, '42');
      assert.equal(Object.isFrozen(command), true);
      return { status: 'applied' };
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { status: 'applied' });
});

test('caller-supplied free-form outcome digest is rejected before persistence', async () => {
  let calls = 0;
  await assert.rejects(executeFinancialIntegritySettlement({ ...fixture(), outcomeDigest: 'f'.repeat(64) }, {
    fenceToken: '42', loadOutcome, commit: async () => { calls += 1; },
  }), /free_form_outcome_digest_forbidden/);
  assert.equal(calls, 0);
});

test('missing persisted outcome blocks financial mutation', async () => {
  let calls = 0;
  await assert.rejects(executeFinancialIntegritySettlement(fixture(), {
    fenceToken: '42',
    loadOutcome: async () => { throw new Error('financial_integrity:outcome_not_persisted'); },
    commit: async () => { calls += 1; },
  }), /outcome_not_persisted/);
  assert.equal(calls, 0);
});

test('persisted outcome boundary mismatch blocks settlement', async () => {
  let calls = 0;
  await assert.rejects(executeFinancialIntegritySettlement(fixture(), {
    fenceToken: '42',
    loadOutcome: async input => ({ ...input, handId: 'other-hand', outcomeDigest: persistedDigest }),
    commit: async () => { calls += 1; },
  }), /outcome_boundary_mismatch/);
  assert.equal(calls, 0);
});

test('shadow mismatch blocks persistence and emits an integrity event', async () => {
  let calls = 0;
  const events = [];
  const maliciousShadow = input => {
    const result = computeShadowSettlement(input);
    return { ...result, allocations: result.allocations.map((row, i) => i === 0 ? { ...row, deltaMinor: '1999' } : row) };
  };
  await assert.rejects(executeFinancialIntegritySettlement(fixture(), {
    fenceToken: '42', loadOutcome, shadow: maliciousShadow,
    commit: async () => { calls += 1; }, onIntegrityEvent: async event => events.push(event),
  }), /shadow_mismatch/);
  assert.equal(calls, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'financial_integrity_block');
});

test('invalid fencing metadata blocks persistence before settlement commit', async () => {
  let calls = 0;
  await assert.rejects(executeFinancialIntegritySettlement(fixture(), {
    fenceToken: '0', loadOutcome, commit: async () => { calls += 1; },
  }), /invalid_fence_token/);
  assert.equal(calls, 0);
});
