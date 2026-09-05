import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTeenPattiDeck, validateTeenPattiDeck } from '../src/game/teen-patti/cards.js';
import { compareTeenPattiHands, evaluateTeenPattiHand } from '../src/game/teen-patti/evaluator.js';
import {
  buildTeenPattiSettlement,
  chaal,
  createTeenPattiRound,
  legalChaalRange,
  pack,
  projectTeenPattiPublic,
  projectTeenPattiSeat,
  requestSideshow,
  respondSideshow,
  seeCards,
  showdown,
} from '../src/game/teen-patti/engine.js';

function card(id) {
  return buildTeenPattiDeck().find((entry) => entry.id === id);
}

function deckForHands(hands, dealerSeat = hands.length - 1) {
  const base = buildTeenPattiDeck();
  const used = new Set(hands.flat());
  const firstSeat = (dealerSeat + 1) % hands.length;
  const front = [];
  for (let round = 0; round < 3; round += 1) {
    for (let offset = 0; offset < hands.length; offset += 1) {
      const seat = (firstSeat + offset) % hands.length;
      front.push(card(hands[seat][round]));
    }
  }
  return [...front, ...base.filter((entry) => !used.has(entry.id))];
}

function players(count, stack = 1000) {
  return Array.from({ length: count }, (_, index) => ({ id: `p${index}`, stack }));
}

test('classic Teen Patti ranking is Trail > Pure Sequence > Sequence > Color > Pair > High Card', () => {
  const hands = [
    ['AS','AH','AD'],
    ['QS','KS','AS'],
    ['QH','KD','AC'],
    ['2S','7S','JS'],
    ['KC','KH','2D'],
    ['AC','9D','4H'],
  ].map((ids) => ids.map(card));
  for (let i = 0; i < hands.length - 1; i += 1) assert.equal(compareTeenPattiHands(hands[i], hands[i + 1]) > 0, true);
  assert.equal(evaluateTeenPattiHand(hands[0]).category, 'trail');
});

test('A-K-Q is highest sequence and A-2-3 is second-highest in the locked baseline', () => {
  assert.equal(compareTeenPattiHands(['AS','KH','QD'].map(card), ['AH','2D','3C'].map(card)) > 0, true);
  assert.equal(compareTeenPattiHands(['AH','2D','3C'].map(card), ['KS','QH','JD'].map(card)) > 0, true);
});

test('deck validation rejects duplicate or metadata-substituted cards', () => {
  const duplicate = buildTeenPattiDeck();
  duplicate[51] = { ...duplicate[0] };
  assert.throws(() => validateTeenPattiDeck(duplicate), /duplicate|52 cards/);
  const metadata = buildTeenPattiDeck();
  metadata[0] = { ...metadata[0], rank: 'A' };
  assert.throws(() => validateTeenPattiDeck(metadata), /metadata mismatch/);
});

test('blind and seen chaal ranges are server-computed and turn ordered', () => {
  const deck = deckForHands([
    ['2C','5D','9H'], ['3C','6D','10H'], ['4C','7D','JH'],
  ]);
  let state = createTeenPattiRound({ players: players(3), deck, boot: 10, dealerSeat: 2 });
  assert.deepEqual(legalChaalRange(state, 0), { min: 10, max: 20 });
  assert.throws(() => chaal(state, 1, 10), /out-of-turn/);
  state = chaal(state, 0, 20);
  assert.equal(state.unitStake, 20);
  state = seeCards(state, 1);
  assert.deepEqual(legalChaalRange(state, 1), { min: 40, max: 80 });
  assert.throws(() => chaal(state, 1, 20), /illegal teen patti chaal/);
  state = chaal(state, 1, 40);
  assert.equal(state.currentSeat, 2);
  assert.equal(state.pot, 90);
});

test('sideshow is seen-to-seen, private, paid, and requester packs on a tie', () => {
  const deck = deckForHands([
    ['AC','AD','2S'], ['AH','AS','2D'], ['3C','6D','9H'],
  ]);
  let state = createTeenPattiRound({ players: players(3), deck, boot: 10, dealerSeat: 2 });
  state = seeCards(state, 0);
  state = chaal(state, 0, 20);
  state = seeCards(state, 1);
  const before = state.pot;
  state = requestSideshow(state, 1);
  assert.equal(state.pot, before + 20);
  assert.equal(projectTeenPattiPublic(state).players.every((player) => player.cards === null), true);
  state = respondSideshow(state, 0, true);
  assert.equal(state.players[1].status, 'packed');
  assert.equal(projectTeenPattiPublic(state).players.every((player) => player.cards === null), true);
});

test('public projection hides live cards and seat projection exposes only viewer cards', () => {
  const deck = deckForHands([
    ['AC','KD','QH'], ['2C','3D','4H'], ['5C','6D','7H'],
  ]);
  const state = createTeenPattiRound({ players: players(3), deck, boot: 10, dealerSeat: 2 });
  const pub = projectTeenPattiPublic(state);
  assert.equal(pub.players.every((player) => player.cards === null), true);
  const seat = projectTeenPattiSeat(state, 0);
  assert.deepEqual(seat.players[0].cards.map((entry) => entry.id), ['AC','KD','QH']);
  assert.equal(seat.players[1].cards, null);
  assert.equal(seat.players[2].cards, null);
});

test('two-player showdown reveals only at completion and conserves the full pot', () => {
  const deck = deckForHands([
    ['AC','AD','AH'], ['KC','KD','2H'],
  ], 1);
  let state = createTeenPattiRound({ players: players(2, 100), deck, boot: 10, dealerSeat: 1 });
  state = seeCards(state, 0);
  state = showdown(state, 0);
  assert.equal(state.phase, 'completed');
  assert.equal(state.result.winnerId, 'p0');
  assert.equal(state.pot, 0);
  assert.equal(state.players.reduce((sum, player) => sum + player.stack, 0), 200);
  const pub = projectTeenPattiPublic(state);
  assert.equal(pub.players[0].cards.length, 3);
  assert.equal(pub.players[1].cards.length, 3);
  const settlement = buildTeenPattiSettlement(state);
  assert.equal(settlement.entries.reduce((sum, entry) => sum + entry.delta, 0), 0);
});

test('pack awards pot without exposing unshown cards', () => {
  const deck = deckForHands([['AC','KD','QH'], ['2C','3D','4H']], 1);
  let state = createTeenPattiRound({ players: players(2, 100), deck, boot: 10, dealerSeat: 1 });
  state = pack(state, 0);
  assert.equal(state.result.winnerId, 'p1');
  assert.equal(projectTeenPattiPublic(state).players.every((player) => player.cards === null), true);
  assert.equal(state.players[0].stack + state.players[1].stack, 200);
});

test('10,000 deterministic hand permutations preserve exact evaluator result', () => {
  const deck = buildTeenPattiDeck();
  for (let i = 0; i < 10_000; i += 1) {
    const start = (i * 7) % 50;
    const hand = [deck[start], deck[start + 1], deck[start + 2]];
    const expected = evaluateTeenPattiHand(hand);
    const rotated = i % 2 === 0 ? [hand[1], hand[2], hand[0]] : [hand[2], hand[0], hand[1]];
    assert.deepEqual(evaluateTeenPattiHand(rotated), expected);
  }
});
