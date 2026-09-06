import test from 'node:test';
import assert from 'node:assert/strict';
import { TableProjectionRouter } from '../src/game/table-projection-router.js';

function holdemState(scope) {
  return {
    game: 'no_limit_texas_holdem', status: 'betting', street: 'preflop', dealerSeat: 0,
    smallBlindSeat: 0, bigBlindSeat: 1, currentSeat: 0, currentBet: 20,
    board: [], pots: [], result: null, showdownSeats: [],
    players: [
      { id: 'alice', seat: 0, stack: 980, status: 'active', streetContribution: 10, totalContribution: 10, hole: [{ secret: `secret-alice-${scope}` }] },
      { id: 'bob', seat: 1, stack: 980, status: 'active', streetContribution: 20, totalContribution: 20, hole: [{ secret: `secret-bob-${scope}` }] },
    ],
  };
}

function marriageState(scope) {
  return {
    game: 'marriage-21', maalMode: 'hidden', maalCard: { secret: `secret-maal-${scope}` }, currentSeat: 0,
    turnStage: 'draw', stock: [{ secret: `secret-stock-${scope}` }], discardPile: [], qualifiedSeats: [], maalSeenBy: [], winnerSeat: null, actionNumber: 0,
    players: [
      { id: 'alice', hand: [{ secret: `secret-alice-${scope}` }] },
      { id: 'bob', hand: [{ secret: `secret-bob-${scope}` }] },
    ],
  };
}

function teenPattiState(scope) {
  return {
    game: 'teen_patti_classic', phase: 'betting', dealerSeat: 0, currentSeat: 0,
    boot: 10, unitStake: 10, pot: 20, actionNo: 0, pendingSideshow: null, result: null,
    players: [
      { id: 'alice', stack: 990, status: 'active', seen: false, contribution: 10, hand: [{ secret: `secret-alice-${scope}` }] },
      { id: 'bob', stack: 990, status: 'active', seen: false, contribution: 10, hand: [{ secret: `secret-bob-${scope}` }] },
    ],
  };
}

function seepState(scope) {
  return {
    version: 1, phase: 'bid', players: ['alice', 'bob', 'cara', 'dan'], dealerIndex: 0,
    bidderIndex: 3, currentPlayerIndex: 3, openingBid: null,
    floorHidden: [`secret-floor-${scope}`], floorLoose: [], houses: [],
    hands: {
      alice: [`secret-alice-${scope}`], bob: [`secret-bob-${scope}`], cara: [`secret-cara-${scope}`], dan: [`secret-dan-${scope}`],
    },
    capturedTeams: [[], []], sweepPoints: [0, 0], turnNumber: 0,
  };
}

function trickState(gameId, scope) {
  return {
    version: 1, gameId, players: ['alice', 'bob', 'cara', 'dan'],
    hands: {
      alice: [`secret-alice-${scope}`], bob: [`secret-bob-${scope}`], cara: [`secret-cara-${scope}`], dan: [`secret-dan-${scope}`],
    },
    captured: { alice: [], bob: [], cara: [], dan: [] },
    leaderIndex: 0, currentPlayerIndex: 0, trick: [], completedTricks: [], trumpRevealed: false,
    trumpSuit: 'S', brokenSuits: [], centerPile: [], finished: false,
  };
}

const GAMES = [
  ['no_limit_texas_holdem', holdemState],
  ['marriage-21', marriageState],
  ['seep-100', seepState],
  ['teen_patti_classic', teenPattiState],
  ...['spades', 'hearts', '29', 'court-piece', 'dehla-pakad'].map(gameId => [gameId, scope => trickState(gameId, scope)]),
];

function session(record, playerId) {
  return {
    subject: `subject-${playerId}-${record.ordinal}`,
    tenantId: record.tenantId,
    tableId: record.tableId,
    playerId,
    membershipVersion: playerId === 'alice' ? record.aliceVersion : record.bobVersion,
  };
}

test('scope-bound router rejects duplicate table ownership and caller-selected reconnect targets', () => {
  let now = 1000;
  const router = new TableProjectionRouter({ clock: () => now });
  const handle = router.openTable({ tenantId: 'tenant-a', tableId: 'table-a' });
  assert.throws(() => router.openTable({ tenantId: 'tenant-a', tableId: 'table-a' }), /table_already_open/);
  handle.publish({
    gameId: 'no_limit_texas_holdem', handId: 'hand-a', stateVersion: 1,
    memberships: [{ playerId: 'alice', version: 1 }, { playerId: 'bob', version: 2 }],
    authoritativeState: holdemState('scope-a'),
  });
  const resume = router.buildReconnect({
    authenticatedSession: { subject: 'subject-alice', tenantId: 'tenant-a', tableId: 'table-a', playerId: 'alice', membershipVersion: 1 },
    tenantId: 'tenant-b', tableId: 'table-b', viewerId: 'bob', authoritativeState: holdemState('forged'),
  });
  const encoded = JSON.stringify(resume);
  assert.match(encoded, /secret-alice-scope-a/);
  assert.doesNotMatch(encoded, /secret-bob-scope-a|forged/);
});

test('2,304 table scopes across 32 tenants isolate reconnect and spectator projections', () => {
  let now = 10_000_000;
  const router = new TableProjectionRouter({ clock: () => now, maxTables: 4096 });
  const records = [];
  let ordinal = 0;

  for (let tenantNo = 0; tenantNo < 32; tenantNo += 1) {
    for (let tableNo = 0; tableNo < 8; tableNo += 1) {
      for (let gameNo = 0; gameNo < GAMES.length; gameNo += 1) {
        const [gameId, makeState] = GAMES[gameNo];
        const tenantId = `tenant-${tenantNo}`;
        const tableId = `table-${tableNo}-game-${gameNo}`;
        const scope = `t${tenantNo}-x${tableNo}-g${gameNo}`;
        const aliceVersion = ordinal * 2 + 1;
        const bobVersion = ordinal * 2 + 2;
        const handle = router.openTable({ tenantId, tableId });
        const authoritativeState = makeState(scope);
        handle.publish({
          gameId,
          handId: `hand-${ordinal}`,
          stateVersion: 1,
          memberships: [
            { playerId: 'alice', version: aliceVersion },
            { playerId: 'bob', version: bobVersion },
            { playerId: 'cara', version: ordinal * 2 + 100_001 },
            { playerId: 'dan', version: ordinal * 2 + 100_002 },
          ],
          authoritativeState,
        });
        records.push({ ordinal, tenantId, tableId, gameId, scope, aliceVersion, bobVersion });
        ordinal += 1;
      }
    }
  }

  assert.equal(records.length, 2304);
  assert.equal(router.openTableCount, 2304);

  // 4,608 valid reconnects: each player receives only their own private state.
  for (const record of records) {
    for (const playerId of ['alice', 'bob']) {
      const resume = router.buildReconnect({ authenticatedSession: session(record, playerId) });
      const encoded = JSON.stringify(resume);
      assert.equal(resume.tenantId, record.tenantId);
      assert.equal(resume.tableId, record.tableId);
      assert.match(encoded, new RegExp(`secret-${playerId}-${record.scope}`));
      const opponent = playerId === 'alice' ? 'bob' : 'alice';
      assert.doesNotMatch(encoded, new RegExp(`secret-${opponent}-${record.scope}`));
    }
    router.captureSpectator({ tenantId: record.tenantId, tableId: record.tableId });
    assert.equal(router.readSpectator({ tenantId: record.tenantId, tableId: record.tableId }), null);
  }

  // 2,304 stale cross-scope token replays fail because each table has a unique membership epoch.
  for (let index = 0; index < records.length; index += 1) {
    const source = records[index];
    const target = records[(index + 1) % records.length];
    const replay = {
      ...session(source, 'alice'),
      tenantId: target.tenantId,
      tableId: target.tableId,
    };
    assert.throws(() => router.buildReconnect({ authenticatedSession: replay }), /stale_membership/);
  }

  now += 30_000;

  // 2,304 delayed spectator snapshots remain public-only and scope-labelled correctly.
  for (const record of records) {
    const spectator = router.readSpectator({ tenantId: record.tenantId, tableId: record.tableId });
    assert.equal(spectator.tenantId, record.tenantId);
    assert.equal(spectator.tableId, record.tableId);
    assert.equal(spectator.gameId, record.gameId);
    assert.equal(JSON.stringify(spectator).includes('secret-'), false);
  }
});

test('publisher mutation, version replay, unknown scopes and table capacity fail closed', () => {
  let now = 5000;
  const router = new TableProjectionRouter({ clock: () => now, maxTables: 1 });
  const handle = router.openTable({ tenantId: 'tenant-a', tableId: 'table-a' });
  const state = holdemState('immutable');
  handle.publish({
    gameId: 'no_limit_texas_holdem', handId: 'hand-a', stateVersion: 1,
    memberships: [{ playerId: 'alice', version: 1 }, { playerId: 'bob', version: 2 }], authoritativeState: state,
  });
  state.players[0].hole[0].secret = 'mutated-after-publish';
  const resume = router.buildReconnect({ authenticatedSession: { subject: 's-alice', tenantId: 'tenant-a', tableId: 'table-a', playerId: 'alice', membershipVersion: 1 } });
  assert.match(JSON.stringify(resume), /secret-alice-immutable/);
  assert.doesNotMatch(JSON.stringify(resume), /mutated-after-publish/);

  assert.throws(() => handle.publish({
    gameId: 'no_limit_texas_holdem', handId: 'hand-a', stateVersion: 1,
    memberships: [{ playerId: 'alice', version: 1 }], authoritativeState: holdemState('replay'),
  }), /non_monotonic_state_version/);
  assert.throws(() => router.openTable({ tenantId: 'tenant-b', tableId: 'table-b' }), /table_capacity_exceeded/);
  assert.throws(() => router.readSpectator({ tenantId: 'tenant-x', tableId: 'table-x' }), /table_not_found/);
});
