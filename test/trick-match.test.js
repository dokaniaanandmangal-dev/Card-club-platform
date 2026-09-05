import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDeck, STANDARD_RANKS } from '../src/game/trick/cards.js';
import { createSpadesBidState, submitSpadesBid, scoreSpadesHand } from '../src/game/trick/spades-match.js';
import { createHeartsPassState, submitHeartsPass, applyHeartsPass, scoreHeartsHand } from '../src/game/trick/hearts-match.js';

const players = ['p0', 'p1', 'p2', 'p3'];

function deal(deck) {
  const hands = players.map(() => []);
  deck.forEach((card, i) => hands[i % 4].push(card));
  return hands;
}

test('Spades bidding is ordered, immutable and complete after four bids', () => {
  let state = createSpadesBidState(players);
  assert.throws(() => submitSpadesBid(state, { playerId: 'p1', bid: 3 }), /out_of_turn/);
  state = submitSpadesBid(state, { playerId: 'p0', bid: 3 });
  state = submitSpadesBid(state, { playerId: 'p1', bid: 2 });
  state = submitSpadesBid(state, { playerId: 'p2', bid: 4 });
  state = submitSpadesBid(state, { playerId: 'p3', bid: 1 });
  assert.equal(state.complete, true);
  assert.deepEqual(state.bids, { p0: 3, p1: 2, p2: 4, p3: 1 });
});

test('Spades scores contract, bags, nil and sandbag penalty deterministically', () => {
  const result = scoreSpadesHand({
    players,
    bids: { p0: 0, p1: 3, p2: 4, p3: 2 },
    teamTricks: [7, 6],
    playerTricks: [0, 3, 7, 3],
    previousScores: [190, 100],
    previousBags: [9, 0],
  });
  assert.deepEqual(result, { scores: [233, 151], bags: [2, 1] });
});

test('Spades rejects inconsistent per-player and team trick totals', () => {
  assert.throws(() => scoreSpadesHand({
    players,
    bids: { p0: 2, p1: 2, p2: 2, p3: 2 },
    teamTricks: [7, 6],
    playerTricks: [3, 3, 3, 4],
  }), /team_trick_mismatch/);
});

test('Hearts pass cycle is left, right, across, none and no transfer happens before all commit', () => {
  const hands = deal(makeDeck(STANDARD_RANKS));
  for (const [handNumber, direction] of ['left', 'right', 'across', 'none'].entries()) {
    let state = createHeartsPassState({ players, hands, handNumber });
    assert.equal(state.direction, direction);
    if (direction === 'none') {
      assert.deepEqual(applyHeartsPass(state), hands);
      continue;
    }
    const original = JSON.parse(JSON.stringify(hands));
    for (const id of players) {
      const selection = state.hands[id].slice(0, 3);
      state = submitHeartsPass(state, { playerId: id, cards: selection });
      if (!state.complete) assert.throws(() => applyHeartsPass(state), /all_passes_required/);
    }
    const passed = applyHeartsPass(state);
    assert.equal(passed.every(hand => hand.length === 13 && new Set(hand).size === 13), true);
    assert.equal(new Set(passed.flat()).size, 52);
    assert.equal(original.flat().sort().join(','), passed.flat().sort().join(','));
  }
});

test('Hearts cumulative scoring ends at target and lowest score wins', () => {
  const result = scoreHeartsHand({
    players,
    adjustedPenalties: { p0: 0, p1: 26, p2: 26, p3: 26 },
    previousScores: [80, 90, 70, 95],
    target: 100,
  });
  assert.deepEqual(result.scores, [80, 116, 96, 121]);
  assert.equal(result.finished, true);
  assert.equal(result.winnerIndex, 0);
});
