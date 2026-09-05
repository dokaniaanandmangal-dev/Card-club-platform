import test from 'node:test';
import assert from 'node:assert/strict';
import { computePrimarySettlement } from '../src/financial/settlement-primary.js';
import { computeShadowSettlement } from '../src/financial/settlement-shadow.js';
import { verifyDualSettlement } from '../src/financial/settlement-controller.js';

function fixture() {
  return {
    tenantId: 'club-a',
    tableId: 'table-7',
    handId: 'hand-00000001',
    epoch: 42,
    participants: [
      { accountId: 'player:bob', openingMinor: '7000', closingMinor: '5000' },
      { accountId: 'player:alice', openingMinor: '3000', closingMinor: '5000' },
    ],
  };
}

test('primary and shadow agree on a balanced settlement', () => {
  const input = fixture();
  const primary = computePrimarySettlement(input);
  const shadow = computeShadowSettlement(input);
  assert.deepEqual(primary, shadow);
  assert.equal(primary.allocations[0].accountId, 'player:alice');
  assert.equal(primary.allocations[0].deltaMinor, '2000');
  assert.equal(primary.allocations[1].deltaMinor, '-2000');
});

test('participant order cannot change canonical settlement digest', () => {
  const a = computePrimarySettlement(fixture());
  const bInput = fixture();
  bInput.participants.reverse();
  const b = computePrimarySettlement(bInput);
  assert.equal(a.digest, b.digest);
  assert.deepEqual(a.allocations, b.allocations);
});

test('value creation or destruction is rejected', () => {
  const input = fixture();
  input.participants[0].closingMinor = '5001';
  assert.throws(() => verifyDualSettlement(input), /value_not_conserved/);
});

test('financial values must be integer decimal strings, never JS numbers or floats', () => {
  const numeric = fixture();
  numeric.participants[0].openingMinor = 7000;
  assert.throws(() => verifyDualSettlement(numeric), /invalid_minor_unit_string/);

  const float = fixture();
  float.participants[0].openingMinor = '7000.50';
  assert.throws(() => verifyDualSettlement(float), /invalid_minor_unit_string/);
});

test('duplicate accounts and malformed identities are rejected', () => {
  const duplicate = fixture();
  duplicate.participants[1].accountId = duplicate.participants[0].accountId;
  assert.throws(() => verifyDualSettlement(duplicate), /duplicate_account/);

  const malformed = fixture();
  malformed.tableId = '../other-table';
  assert.throws(() => verifyDualSettlement(malformed), /invalid_identifier/);
});

test('amounts beyond PostgreSQL bigint range are rejected', () => {
  const input = fixture();
  input.participants[0].openingMinor = '9223372036854775808';
  assert.throws(() => verifyDualSettlement(input), /out_of_range/);
});

test('shadow disagreement blocks settlement', () => {
  const maliciousShadow = input => {
    const result = computeShadowSettlement(input);
    return {
      ...result,
      allocations: result.allocations.map((row, index) => index === 0 ? { ...row, deltaMinor: '1999' } : row),
    };
  };
  assert.throws(() => verifyDualSettlement(fixture(), { shadow: maliciousShadow }), /shadow_mismatch/);
});

test('10,000 deterministic conserved settlements agree across independent implementations', () => {
  let state = 0x5eed1234;
  const rand = max => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % max;
  };

  for (let caseNo = 0; caseNo < 10_000; caseNo += 1) {
    const count = 2 + rand(8);
    const stacks = Array.from({ length: count }, () => 10_000n + BigInt(rand(1_000_000)));
    const closing = [...stacks];
    for (let move = 0; move < 20; move += 1) {
      const from = rand(count);
      let to = rand(count - 1);
      if (to >= from) to += 1;
      const available = closing[from];
      if (available === 0n) continue;
      const amount = BigInt(rand(Number(available > 1000n ? 1000n : available) + 1));
      closing[from] -= amount;
      closing[to] += amount;
    }

    const input = {
      tenantId: `club-${caseNo % 17}`,
      tableId: `table-${caseNo % 101}`,
      handId: `hand-${caseNo}`,
      epoch: caseNo,
      participants: stacks.map((opening, i) => ({
        accountId: `player:${i}`,
        openingMinor: opening.toString(),
        closingMinor: closing[i].toString(),
      })),
    };

    const primary = computePrimarySettlement(input);
    const shadow = computeShadowSettlement(input);
    assert.equal(primary.digest, shadow.digest);
    assert.deepEqual(primary.allocations, shadow.allocations);
    assert.equal(verifyDualSettlement(input).verifiedByShadow, true);
  }
});
