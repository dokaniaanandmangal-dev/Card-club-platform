import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReconnectProjection, SUPPORTED_RECONNECT_GAMES } from '../src/game/reconnect-projection.js';

function tableContext(version = 7) {
  return {
    tenantId: 'tenant-a',
    tableId: 'table-1',
    handId: `hand-${version}`,
    stateVersion: version,
    memberships: [
      { playerId: 'alice', version: 11 },
      { playerId: 'bob', version: 22 },
      { playerId: 'cara', version: 33 },
      { playerId: 'dan', version: 44 },
    ],
  };
}

function session(playerId) {
  const versions = { alice: 11, bob: 22, cara: 33, dan: 44 };
  return {
    subject: `subject-${playerId}`,
    tenantId: 'tenant-a',
    tableId: 'table-1',
    playerId,
    membershipVersion: versions[playerId],
  };
}

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
    game: 'marriage-21', maalMode: 'hidden', maalCard: { secret: `maal-${suffix}` }, currentSeat: 0,
    turnStage: 'draw', stock: [], discardPile: [], qualifiedSeats: [], maalSeenBy: [], winnerSeat: null, actionNumber: 0,
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
    version: 1, phase: 'play', players: ['alice', 'bob', 'cara', 'dan'], dealerIndex: 0,
    bidderIndex: 3, currentPlayerIndex: 0, openingBid: 10, floorLoose: [], floorHidden: [], houses: [],
    hands: {
      alice: [`alice-seep-${suffix}`], bob: [`bob-seep-${suffix}`], cara: [`cara-seep-${suffix}`], dan: [`dan-seep-${suffix}`],
    },
    capturedTeams: [[], []], sweepPoints: [0, 0], turnNumber: 3,
  };
}

function trickState(gameId, suffix) {
  return {
    version: 1, gameId, players: ['alice', 'bob', 'cara', 'dan'],
    hands: {
      alice: [`alice-${gameId}-${suffix}`], bob: [`bob-${gameId}-${suffix}`], cara: [`cara-${gameId}-${suffix}`], dan: [`dan-${gameId}-${suffix}`],
    },
    captured: { alice: [], bob: [], cara: [], dan: [] },
    leaderIndex: 0, currentPlayerIndex: 0, trick: [], completedTricks: [], trumpRevealed: false, trumpSuit: 'S',
    brokenSuits: [], centerPile: [], finished: false,
  };
}

const CASES = [
  { gameId: 'no_limit_texas_holdem', make: holdemState, alice: s => `alice-holdem-${s}`, bob: s => `bob-holdem-${s}` },
  { gameId: 'marriage-21', make: marriageState, alice: s => `alice-marriage-${s}`, bob: s => `bob-marriage-${s}` },
  { gameId: 'seep-100', make: seepState, alice: s => `alice-seep-${s}`, bob: s => `bob-seep-${s}` },
  { gameId: 'teen_patti_classic', make: teenPattiState, alice: s => `alice-teen-${s}`, bob: s => `bob-teen-${s}` },
  ...['spades', 'hearts', '29', 'court-piece', 'dehla-pakad'].map((gameId) => ({
    gameId,
    make: suffix => trickState(gameId, suffix),
    alice: suffix => `alice-${gameId}-${suffix}`,
    bob: suffix => `bob-${gameId}-${suffix}`,
  })),
];

test('reconnect certification covers all nine supported game identifiers', () => {
  assert.equal(CASES.length, 9);
  assert.deepEqual([...SUPPORTED_RECONNECT_GAMES].sort(), CASES.map(entry => entry.gameId).sort());
});

test('9,216 reconnect projections preserve per-player hidden-state isolation', () => {
  for (const entry of CASES) {
    for (let iteration = 0; iteration < 512; iteration += 1) {
      const suffix = `${iteration}`;
      const state = entry.make(suffix);
      const context = tableContext(iteration);

      const aliceResume = buildReconnectProjection({
        gameId: entry.gameId,
        authoritativeState: state,
        authenticatedSession: session('alice'),
        tableContext: context,
      });
      const bobResume = buildReconnectProjection({
        gameId: entry.gameId,
        authoritativeState: state,
        authenticatedSession: session('bob'),
        tableContext: context,
      });

      const aliceJson = JSON.stringify(aliceResume);
      const bobJson = JSON.stringify(bobResume);
      assert.match(aliceJson, new RegExp(entry.alice(suffix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.doesNotMatch(aliceJson, new RegExp(entry.bob(suffix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(bobJson, new RegExp(entry.bob(suffix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.doesNotMatch(bobJson, new RegExp(entry.alice(suffix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.equal(aliceResume.playerId, 'alice');
      assert.equal(bobResume.playerId, 'bob');
    }
  }
});

test('caller-controlled viewer or seat hints cannot change authenticated reconnect identity', () => {
  const state = holdemState('spoof');
  const resume = buildReconnectProjection({
    gameId: 'no_limit_texas_holdem',
    authoritativeState: state,
    authenticatedSession: session('alice'),
    tableContext: tableContext(),
    viewerSeat: 1,
    viewerId: 'bob',
  });
  const encoded = JSON.stringify(resume);
  assert.match(encoded, /alice-holdem-spoof/);
  assert.doesNotMatch(encoded, /bob-holdem-spoof/);
});

test('cross-tenant, cross-table and stale-membership reconnect attempts fail closed', () => {
  const state = holdemState('scope');

  const wrongTenant = { ...session('alice'), tenantId: 'tenant-b' };
  assert.throws(() => buildReconnectProjection({ gameId: 'no_limit_texas_holdem', authoritativeState: state, authenticatedSession: wrongTenant, tableContext: tableContext() }), /tenant_mismatch/);

  const wrongTable = { ...session('alice'), tableId: 'table-2' };
  assert.throws(() => buildReconnectProjection({ gameId: 'no_limit_texas_holdem', authoritativeState: state, authenticatedSession: wrongTable, tableContext: tableContext() }), /table_mismatch/);

  const stale = { ...session('alice'), membershipVersion: 10 };
  assert.throws(() => buildReconnectProjection({ gameId: 'no_limit_texas_holdem', authoritativeState: state, authenticatedSession: stale, tableContext: tableContext() }), /stale_membership/);
});

test('game substitution and removed-player recovery fail closed', () => {
  const state = holdemState('binding');
  assert.throws(() => buildReconnectProjection({
    gameId: 'teen_patti_classic', authoritativeState: state, authenticatedSession: session('alice'), tableContext: tableContext(),
  }), /authoritative_game_mismatch/);

  const removed = tableContext();
  removed.memberships = removed.memberships.filter(entry => entry.playerId !== 'alice');
  assert.throws(() => buildReconnectProjection({
    gameId: 'no_limit_texas_holdem', authoritativeState: state, authenticatedSession: session('alice'), tableContext: removed,
  }), /membership_missing/);
});

test('resume envelope is recursively frozen and never contains the authoritative object', () => {
  const state = marriageState('freeze');
  const resume = buildReconnectProjection({
    gameId: 'marriage-21', authoritativeState: state, authenticatedSession: session('alice'), tableContext: tableContext(),
  });
  assert.equal(Object.isFrozen(resume), true);
  assert.equal(Object.isFrozen(resume.projection), true);
  assert.notEqual(resume.projection, state);
  assert.equal('authoritativeState' in resume, false);
  assert.throws(() => { resume.playerId = 'bob'; }, TypeError);
});
