import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDeck, TWENTY_NINE_RANKS } from '../src/game/trick/cards.js';
import {
  createTwentyNineAuction,
  submitTwentyNineCall,
  chooseTwentyNineTrump,
  completeTwentyNineDeal,
  adjustedTwentyNineContract,
  scoreTwentyNineHand,
} from '../src/game/trick/twenty-nine-match.js';

const players = ['p0', 'p1', 'p2', 'p3'];

function deal(deck) {
  const hands = players.map(() => []);
  deck.forEach((card, i) => hands[i % 4].push(card));
  return hands;
}

function splitDeal() {
  const full = deal(makeDeck(TWENTY_NINE_RANKS));
  return {
    first: full.map(hand => hand.slice(0, 4)),
    second: full.map(hand => hand.slice(4)),
  };
}

test('29 auction forces dealer to minimum when first three players pass', () => {
  const { first } = splitDeal();
  let state = createTwentyNineAuction({ players, firstFourHands: first, dealerIndex: 3 });
  state = submitTwentyNineCall(state, { playerId: 'p0', call: 'pass' });
  state = submitTwentyNineCall(state, { playerId: 'p1', call: 'pass' });
  state = submitTwentyNineCall(state, { playerId: 'p2', call: 'pass' });
  assert.equal(state.phase, 'trump-selection');
  assert.equal(state.highBid, 15);
  assert.equal(state.highBidder, 'p3');
  assert.equal(state.calls.at(-1).forced, true);
});

test('29 auction requires strictly increasing bids and three passes after the high bid', () => {
  const { first } = splitDeal();
  let state = createTwentyNineAuction({ players, firstFourHands: first, dealerIndex: 3 });
  state = submitTwentyNineCall(state, { playerId: 'p0', call: 16 });
  assert.throws(() => submitTwentyNineCall(state, { playerId: 'p1', call: 16 }), /invalid_bid/);
  state = submitTwentyNineCall(state, { playerId: 'p1', call: 17 });
  state = submitTwentyNineCall(state, { playerId: 'p2', call: 'pass' });
  state = submitTwentyNineCall(state, { playerId: 'p3', call: 'pass' });
  state = submitTwentyNineCall(state, { playerId: 'p0', call: 'pass' });
  assert.equal(state.phase, 'trump-selection');
  assert.equal(state.highBidder, 'p1');
  assert.equal(state.highBid, 17);
});

test('only the high bidder can select hidden trump and second deal must complete the exact deck', () => {
  const { first, second } = splitDeal();
  let state = createTwentyNineAuction({ players, firstFourHands: first, dealerIndex: 3 });
  state = submitTwentyNineCall(state, { playerId: 'p0', call: 16 });
  state = submitTwentyNineCall(state, { playerId: 'p1', call: 'pass' });
  state = submitTwentyNineCall(state, { playerId: 'p2', call: 'pass' });
  state = submitTwentyNineCall(state, { playerId: 'p3', call: 'pass' });
  assert.throws(() => chooseTwentyNineTrump(state, { playerId: 'p1', trumpSuit: 'H' }), /only_high_bidder/);
  state = chooseTwentyNineTrump(state, { playerId: 'p0', trumpSuit: 'H' });
  const setup = completeTwentyNineDeal(state, { remainingHands: second });
  assert.equal(setup.bid, 16);
  assert.equal(setup.bidderId, 'p0');
  assert.equal(setup.trumpSuit, 'H');
  assert.equal(new Set(setup.hands.flat()).size, 32);
});

test('29 Pair adjusts bidder contract by four within configured bounds', () => {
  assert.equal(adjustedTwentyNineContract({ bid: 18, bidderTeam: 0, pairTeam: 0 }), 15);
  assert.equal(adjustedTwentyNineContract({ bid: 26, bidderTeam: 0, pairTeam: 1 }), 28);
  assert.equal(adjustedTwentyNineContract({ bid: 20, bidderTeam: 1, pairTeam: null }), 20);
});

test('29 result scores success/failure against the adjusted contract without inventing value', () => {
  assert.deepEqual(scoreTwentyNineHand({ bid: 19, bidderTeam: 0, teamPoints: [16, 12], pairTeam: 0 }), {
    contract: 15,
    success: true,
    bidderTeam: 0,
    winnerTeam: 0,
    bidderGamePointDelta: 1,
  });
  assert.equal(scoreTwentyNineHand({ bid: 19, bidderTeam: 0, teamPoints: [18, 10], pairTeam: 1 }).success, false);
});
