import test from 'node:test';
import assert from 'node:assert/strict';
import { SPECTATOR_POLICY, SpectatorDelayBuffer } from '../src/game/spectator-delay.js';

function holdemState(suffix) {
  return {
    game: 'no_limit_texas_holdem', status: 'betting', street: 'preflop', dealerSeat: 0,
    smallBlindSeat: 0, bigBlindSeat: 1, currentSeat: 0, currentBet: 20,
    board: [], pots: [], result: null, showdownSeats: [],
    players: [
      { id: 'alice', seat: 0, stack: 980, status: 'active', streetContribution: 10, totalContribution: 10, hole: [{ secret: `alice-holdem-${suffix}` }] },
      { id: 'bob', seat: 1, stack: 980, status: 'active', streetContribution: 20, totalContribution: 20, hole: [{ secret: `bob-holdem-${suffix}` }] },
    ],
  };
}

function marriageState(suffix) {
  return {
    game: 'marriage-21', maalMode: 'hidden', maalCard: { secret: `hidden-maal-${suffix}` }, currentSeat: 0,
    turnStage: 'draw', stock: [{ secret: `stock-${suffix}` }], discardPile: [], qualifiedSeats: [], maalSeenBy: [], winnerSeat: null, actionNumber: 0,
    players: [
      { id: 'alice', hand: [{ secret: `alice-marriage-${suffix}` }] },
      { id: 'bob', hand: [{ secret: `bob-marriage-${suffix}` }] },
    ],
  };
}

function teenPattiState(suffix) {
  return {
    game: 'teen_patti_classic', phase: 'betting', dealerSeat: 0, currentSeat: 0,
    boot: 10, unitStake: 10, pot: 20, actionNo: 0, pendingSideshow: null, result: null,
    players: [
      { id: 'alice', stack: 990, status: 'active', seen: false, contribution: 10, hand: [{ secret: `alice-teen-${suffix}` }] },
      { id: 'bob', stack: 990, status: 'active', seen: false, contribution: 10, hand: [{ secret: `bob-teen-${suffix}` }] },
    ],
  };
}

function seepState(suffix) {
  return {
    version: 1, phase: 'bid', players: ['alice', 'bob', 'cara', 'dan'], dealerIndex: 0,
    bidderIndex: 3, currentPlayerIndex: 3, openingBid: null,
    floorHidden: [`hidden-floor-${suffix}`], floorLoose: [], houses: [],
    hands: {
      alice: [`alice-seep-${suffix}`], bob: [`bob-seep-${suffix}`], cara: [`cara-seep-${suffix}`], dan: [`dan-seep-${suffix}`],
    },
    capturedTeams: [[], []], sweepPoints: [0, 0], turnNumber: 0,
  };
}

function trickState(gameId, suffix) {
  return {
    version: 1, gameId, players: ['alice', 'bob', 'cara', 'dan'],
    hands: {
      alice: [`alice-${gameId}-${suffix}`], bob: [`bob-${gameId}-${suffix}`], cara: [`cara-${gameId}-${suffix}`], dan: [`dan-${gameId}-${suffix}`],
    },
    captured: { alice: [], bob: [], cara: [], dan: [] },
    leaderIndex: 0, currentPlayerIndex: 0, trick: [], completedTricks: [],
    trumpRevealed: false, trumpSuit: 'S', brokenSuits: [], centerPile: [], finished: false,
  };
}

const CASES = [
  { gameId: 'no_limit_texas_holdem', make: holdemState, forbidden: s => [`alice-holdem-${s}`, `bob-holdem-${s}`] },
  { gameId: 'marriage-21', make: marriageState, forbidden: s => [`alice-marriage-${s}`, `bob-marriage-${s}`, `hidden-maal-${s}`, `stock-${s}`] },
  { gameId: 'seep-100', make: seepState, forbidden: s => [`alice-seep-${s}`, `bob-seep-${s}`, `hidden-floor-${s}`] },
  { gameId: 'teen_patti_classic', make: teenPattiState, forbidden: s => [`alice-teen-${s}`, `bob-teen-${s}`] },
  ...['spades', 'hearts', '29', 'court-piece', 'dehla-pakad'].map((gameId) => ({
    gameId,
    make: suffix => trickState(gameId, suffix),
    forbidden: suffix => [`alice-${gameId}-${suffix}`, `bob-${gameId}-${suffix}`],
  })),
];

test('spectator certification uses a mandatory public-only delay of at least 30 seconds', () => {
  assert.equal(SPECTATOR_POLICY.mode, 'public_projection_only');
  assert.equal(SPECTATOR_POLICY.minimumDelayMs, 30_000);
  assert.throws(() => new SpectatorDelayBuffer({ tenantId: 'tenant-a', tableId: 'table-1', gameId: 'spades', delayMs: 29_999 }), /delay_outside_certified_policy/);
});

test('4,608 delayed spectator projections expose no private game state across all nine games', () => {
  assert.equal(CASES.length, 9);
  for (const entry of CASES) {
    for (let iteration = 0; iteration < 512; iteration += 1) {
      let now = 1_000_000 + iteration;
      const buffer = new SpectatorDelayBuffer({
        tenantId: 'tenant-a', tableId: `table-${iteration}`, gameId: entry.gameId,
        delayMs: 30_000, clock: () => now,
      });
      const suffix = `${iteration}`;
      const receipt = buffer.publish({ handId: `hand-${iteration}`, stateVersion: 1, authoritativeState: entry.make(suffix) });
      assert.equal(receipt.eligibleAt, now + 30_000);
      assert.equal(buffer.readLatest(), null);
      now += 29_999;
      assert.equal(buffer.readLatest(), null);
      now += 1;
      const snapshot = buffer.readLatest();
      assert.equal(snapshot.gameId, entry.gameId);
      assert.equal(snapshot.stateVersion, 1);
      const encoded = JSON.stringify(snapshot);
      for (const secret of entry.forbidden(suffix)) assert.equal(encoded.includes(secret), false, `${entry.gameId} leaked ${secret}`);
      assert.equal('authoritativeState' in snapshot, false);
      assert.equal(Object.isFrozen(snapshot), true);
      assert.equal(Object.isFrozen(snapshot.projection), true);
    }
  }
});

test('spectator release returns the newest eligible snapshot, never a newer in-delay state', () => {
  let now = 10_000;
  const buffer = new SpectatorDelayBuffer({ tenantId: 'tenant-a', tableId: 'table-1', gameId: 'no_limit_texas_holdem', clock: () => now });
  buffer.publish({ handId: 'hand-1', stateVersion: 1, authoritativeState: holdemState('v1') });
  now += 20_000;
  buffer.publish({ handId: 'hand-1', stateVersion: 2, authoritativeState: holdemState('v2') });
  now += 10_000;
  assert.equal(buffer.readLatest().stateVersion, 1);
  now += 20_000;
  assert.equal(buffer.readLatest().stateVersion, 2);
});

test('game substitution, version replay, clock rollback and buffer overflow fail closed', () => {
  let now = 100_000;
  const mismatch = new SpectatorDelayBuffer({ tenantId: 'tenant-a', tableId: 'table-1', gameId: 'teen_patti_classic', clock: () => now });
  assert.throws(() => mismatch.publish({ handId: 'hand-1', stateVersion: 1, authoritativeState: holdemState('bad') }), /authoritative_game_mismatch/);

  const replay = new SpectatorDelayBuffer({ tenantId: 'tenant-a', tableId: 'table-2', gameId: 'spades', clock: () => now });
  replay.publish({ handId: 'hand-1', stateVersion: 5, authoritativeState: trickState('spades', 'one') });
  assert.throws(() => replay.publish({ handId: 'hand-1', stateVersion: 5, authoritativeState: trickState('spades', 'two') }), /non_monotonic_state_version/);

  now -= 1;
  assert.throws(() => replay.readLatest(), /clock_rollback/);

  now = 200_000;
  const bounded = new SpectatorDelayBuffer({ tenantId: 'tenant-a', tableId: 'table-3', gameId: 'spades', maxBufferedSnapshots: 1, clock: () => now });
  bounded.publish({ handId: 'hand-1', stateVersion: 1, authoritativeState: trickState('spades', 'one') });
  assert.throws(() => bounded.publish({ handId: 'hand-1', stateVersion: 2, authoritativeState: trickState('spades', 'two') }), /buffer_capacity_exceeded/);
});
