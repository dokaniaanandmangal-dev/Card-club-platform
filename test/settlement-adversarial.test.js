import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyDualSettlement } from '../src/financial/settlement-controller.js';
import { computeShadowSettlement } from '../src/financial/settlement-shadow.js';

function fixture(caseNo) {
  const move = 1 + (caseNo % 5000);
  return {
    tenantId: `club-${caseNo % 31}`,
    tableId: `table-${caseNo % 211}`,
    handId: `hand-attack-${caseNo}`,
    epoch: caseNo,
    outcomeDigest: (caseNo + 1).toString(16).padStart(64, '0'),
    participants: [
      { accountId: 'player:alice', openingMinor: '10000', closingMinor: String(10000 + move) },
      { accountId: 'player:bob', openingMinor: '10000', closingMinor: String(10000 - move) },
    ],
  };
}

const maliciousShadow = input => {
  const result = computeShadowSettlement(input);
  return {
    ...result,
    allocations: result.allocations.map((row, index) => (
      index === 0 ? { ...row, deltaMinor: String(BigInt(row.deltaMinor) + 1n) } : row
    )),
  };
};

test('100,000 deterministic adversarial settlements are rejected fail-closed', () => {
  let rejected = 0;
  const total = 100_000;

  for (let caseNo = 0; caseNo < total; caseNo += 1) {
    const input = fixture(caseNo);
    const attack = caseNo % 10;
    let options;

    switch (attack) {
      case 0:
        input.outcomeDigest = 'tampered';
        break;
      case 1:
        input.participants[0].closingMinor = String(BigInt(input.participants[0].closingMinor) + 1n);
        break;
      case 2:
        input.participants[1].accountId = input.participants[0].accountId;
        break;
      case 3:
        input.tableId = '../cross-tenant';
        break;
      case 4:
        input.participants[0].openingMinor = '10000.5';
        break;
      case 5:
        input.participants[0].openingMinor = 10000;
        break;
      case 6:
        input.participants[0].openingMinor = '9223372036854775808';
        break;
      case 7:
        input.epoch = -1;
        break;
      case 8:
        input.handId = '';
        break;
      case 9:
        options = { shadow: maliciousShadow };
        break;
      default:
        throw new Error('unreachable');
    }

    try {
      verifyDualSettlement(input, options);
    } catch {
      rejected += 1;
    }
  }

  assert.equal(rejected, total);
});

test('verified settlement is deterministic across 10,000 exact replays', () => {
  const input = fixture(999_999);
  const expected = verifyDualSettlement(input);
  for (let i = 0; i < 10_000; i += 1) {
    const replay = verifyDualSettlement(input);
    assert.equal(replay.digest, expected.digest);
    assert.deepEqual(replay.allocations, expected.allocations);
    assert.equal(replay.outcomeDigest, expected.outcomeDigest);
  }
});
