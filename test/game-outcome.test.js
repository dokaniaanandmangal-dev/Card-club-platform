import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAuthoritativeOutcome,
  projectPublicOutcome,
  projectSeatOutcome,
  verifyOutcomeChain,
} from '../src/game/outcome.js';

function fixture(overrides = {}) {
  return {
    tenantId: 'club-a',
    tableId: 'table-7',
    handId: 'hand-0001',
    epoch: 4,
    sequence: 0,
    previousOutcomeDigest: null,
    publicState: { phase: 'settled', board: ['AS', '7H', '2C'] },
    seats: [
      { seatId: 'seat-2', playerId: 'player:bob', publicState: { folded: false }, privateState: { hole: ['KH', 'KD'], nonce: 'SECRET_BOB' } },
      { seatId: 'seat-1', playerId: 'player:alice', publicState: { folded: false }, privateState: { hole: ['AH', 'AD'], nonce: 'SECRET_ALICE' } },
    ],
    ...overrides,
  };
}

test('authoritative digest is deterministic across object and seat ordering', () => {
  const a = createAuthoritativeOutcome(fixture());
  const input = fixture();
  input.seats.reverse();
  input.publicState = { board: ['AS', '7H', '2C'], phase: 'settled' };
  const b = createAuthoritativeOutcome(input);
  assert.equal(a.outcomeDigest, b.outcomeDigest);
  assert.deepEqual(a.seats.map(s => s.seatId), ['seat-1', 'seat-2']);
});

test('hidden-state tampering changes commitment without exposing the secret', () => {
  const a = createAuthoritativeOutcome(fixture());
  const changed = fixture();
  changed.seats[0].privateState.hole[0] = 'QS';
  const b = createAuthoritativeOutcome(changed);
  assert.notEqual(a.outcomeDigest, b.outcomeDigest);
  assert.deepEqual(projectPublicOutcome(a).publicState, projectPublicOutcome(b).publicState);
});

test('public projection contains no private state from any seat', () => {
  const authoritative = createAuthoritativeOutcome(fixture());
  const encoded = JSON.stringify(projectPublicOutcome(authoritative));
  assert.doesNotMatch(encoded, /SECRET_ALICE|SECRET_BOB|privateState|\"hole\"/);
});

test('seat projection receives only its own private state', () => {
  const authoritative = createAuthoritativeOutcome(fixture());
  const alice = JSON.stringify(projectSeatOutcome(authoritative, 'seat-1'));
  assert.match(alice, /SECRET_ALICE/);
  assert.doesNotMatch(alice, /SECRET_BOB/);
  assert.throws(() => projectSeatOutcome(authoritative, 'seat-99'), /not_found/);
});

test('outcome construction detaches from mutable caller input and freezes results', () => {
  const input = fixture();
  const authoritative = createAuthoritativeOutcome(input);
  const digest = authoritative.outcomeDigest;
  input.seats[0].privateState.hole[0] = 'XX';
  input.publicState.phase = 'tampered';
  assert.equal(authoritative.outcomeDigest, digest);
  assert.equal(authoritative.publicState.phase, 'settled');
  assert.equal(Object.isFrozen(authoritative), true);
  assert.equal(Object.isFrozen(authoritative.seats[0].privateState), true);
});

test('table outcome chain rejects gaps, reordering and cross-table substitution', () => {
  const first = createAuthoritativeOutcome(fixture());
  const second = createAuthoritativeOutcome(fixture({
    handId: 'hand-0002',
    sequence: 1,
    previousOutcomeDigest: first.outcomeDigest,
  }));
  assert.equal(verifyOutcomeChain(first, second), true);

  const gap = createAuthoritativeOutcome(fixture({
    handId: 'hand-0003', sequence: 2, previousOutcomeDigest: first.outcomeDigest,
  }));
  assert.throws(() => verifyOutcomeChain(first, gap), /sequence_gap/);

  const otherTable = createAuthoritativeOutcome(fixture({
    tableId: 'table-8', handId: 'hand-0002', sequence: 1, previousOutcomeDigest: first.outcomeDigest,
  }));
  assert.throws(() => verifyOutcomeChain(first, otherTable), /boundary_mismatch/);
});

test('invalid chain metadata and unsafe state structures fail closed', () => {
  assert.throws(() => createAuthoritativeOutcome(fixture({ sequence: 1, previousOutcomeDigest: null })), /previousOutcomeDigest/);
  const duplicate = fixture();
  duplicate.seats[1].playerId = duplicate.seats[0].playerId;
  assert.throws(() => createAuthoritativeOutcome(duplicate), /duplicate_player/);

  const cyclic = fixture();
  cyclic.publicState.self = cyclic.publicState;
  assert.throws(() => createAuthoritativeOutcome(cyclic), /cyclic/);
});

test('10,000 deterministic hidden-state isolation cases leak no opponent secret', () => {
  for (let i = 0; i < 10_000; i += 1) {
    const aliceSecret = `ALICE_ONLY_${i}`;
    const bobSecret = `BOB_ONLY_${i}`;
    const authoritative = createAuthoritativeOutcome(fixture({
      handId: `hand-${i}`,
      publicState: { phase: 'active', pot: i },
      seats: [
        { seatId: 'seat-1', playerId: 'player:alice', publicState: { stack: i + 100 }, privateState: { secret: aliceSecret, cards: ['AS', 'KD'] } },
        { seatId: 'seat-2', playerId: 'player:bob', publicState: { stack: i + 200 }, privateState: { secret: bobSecret, cards: ['QC', 'JH'] } },
      ],
    }));
    const publicEncoded = JSON.stringify(projectPublicOutcome(authoritative));
    const aliceEncoded = JSON.stringify(projectSeatOutcome(authoritative, 'seat-1'));
    const bobEncoded = JSON.stringify(projectSeatOutcome(authoritative, 'seat-2'));
    assert.equal(publicEncoded.includes(aliceSecret) || publicEncoded.includes(bobSecret), false);
    assert.equal(aliceEncoded.includes(aliceSecret), true);
    assert.equal(aliceEncoded.includes(bobSecret), false);
    assert.equal(bobEncoded.includes(bobSecret), true);
    assert.equal(bobEncoded.includes(aliceSecret), false);
  }
});
