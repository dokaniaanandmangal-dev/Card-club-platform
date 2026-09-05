import test from 'node:test';
import assert from 'node:assert/strict';
import { SEEP_DECK, seepCardPoints, seepCardValue } from '../src/game/seep/cards.js';
import {
  createSeepOpening,
  submitSeepBid,
  playSeepTurn,
  completeSeepDeal,
  projectSeepState,
  scoreSeepHand,
  updateSeepMatch,
} from '../src/game/seep/engine.js';

const players = ['p0', 'p1', 'p2', 'p3'];
const bidderHand = ['9C', '4C', 'KS', '2C'];
const floorCards = ['5D', '3H', 'AS', '10D'];

function makeRemaining(required = {}) {
  const initial = new Set([...bidderHand, ...floorCards]);
  const pool = SEEP_DECK.filter(card => !initial.has(card));
  const sizes = [12, 12, 12, 8];
  const forcedByPlayer = Object.fromEntries(players.map(id => [id, [...(required[id] ?? [])]]));

  // Reserve every forced fixture card before any arbitrary filler is assigned.
  // Otherwise an earlier hand can consume a card required by a later hand.
  for (const id of players) {
    for (const card of forcedByPlayer[id]) {
      const position = pool.indexOf(card);
      if (position < 0) throw new Error(`fixture duplicate/missing ${card}`);
      pool.splice(position, 1);
    }
  }

  const hands = players.map((id, index) => {
    const cards = [...forcedByPlayer[id]];
    if (cards.length > sizes[index]) throw new Error(`fixture too many forced cards for ${id}`);
    while (cards.length < sizes[index]) cards.push(pool.shift());
    return cards;
  });
  assert.equal(pool.length, 0);
  return hands;
}

function buildOpeningFixture() {
  let state = createSeepOpening({ players, dealerIndex: 0, bidderHand, floorCards });
  assert.equal(state.bidderIndex, 3);
  assert.equal(projectSeepState(state).floor, null);
  assert.equal(projectSeepState(state).floorCount, 4);
  state = submitSeepBid(state, { playerId: 'p3', bid: 9 });
  state = playSeepTurn(state, {
    playerId: 'p3',
    action: { type: 'build', card: '4C', targetValue: 9, looseCards: ['5D'] },
  });
  assert.equal(state.houses[0].value, 9);
  const remainingHands = makeRemaining({
    p0: ['3C', 'QH'],
    p1: ['6D', '9S', 'JH'],
    p2: ['9D', 'QS'],
    p3: ['QC', 'QD'],
  });
  return completeSeepDeal(state, { remainingHands });
}

test('100-point Seep card values conserve exactly 100 scoring points', () => {
  assert.equal(SEEP_DECK.reduce((sum, card) => sum + seepCardPoints(card), 0), 100);
  assert.equal(seepCardValue('AS'), 1);
  assert.equal(seepCardValue('JH'), 11);
  assert.equal(seepCardPoints('10D'), 6);
  assert.equal(seepCardPoints('KS'), 13);
});

test('opening floor is hidden until a valid 9-13 bid backed by bidder hand', () => {
  let state = createSeepOpening({ players, dealerIndex: 0, bidderHand, floorCards });
  assert.throws(() => submitSeepBid(state, { playerId: 'p0', bid: 9 }), /only_bidder/);
  assert.throws(() => submitSeepBid(state, { playerId: 'p3', bid: 12 }), /bid_card_required/);
  state = submitSeepBid(state, { playerId: 'p3', bid: 9 });
  assert.deepEqual([...state.floorLoose].sort(), [...floorCards].sort());
  assert.equal(state.floorHidden.length, 0);
});

test('opening house requires retained capture card and full deal must be exact 52-card permutation', () => {
  const state = buildOpeningFixture();
  assert.equal(state.phase, 'play');
  assert.equal(state.currentPlayerIndex, 2);
  assert.equal(state.hands.p3.length, 11);
  assert.equal(state.hands.p0.length, 12);
  assert.equal(new Set([
    ...Object.values(state.hands).flat(),
    ...state.floorLoose,
    ...state.houses.flatMap(house => house.layers.flat()),
    ...state.capturedTeams.flat(),
  ]).size, 52);
});

test('house capture, rebuild, break and cement are server-authoritative', () => {
  let state = buildOpeningFixture();
  state = playSeepTurn(state, { playerId: 'p2', action: { type: 'capture', card: '9D', houseIds: ['h1'], looseGroups: [] } });
  assert.equal(state.houses.length, 0);

  state = playSeepTurn(state, { playerId: 'p1', action: { type: 'build', card: '6D', targetValue: 9, looseCards: ['3H'] } });
  assert.equal(state.houses[0].value, 9);
  assert.equal(state.houses[0].cemented, false);

  state = playSeepTurn(state, { playerId: 'p0', action: { type: 'break', card: '3C', houseId: 'h2', newValue: 12 } });
  assert.equal(state.houses[0].value, 12);
  assert.deepEqual(state.houses[0].owners, ['p0']);

  state = playSeepTurn(state, { playerId: 'p3', action: { type: 'cement', card: 'QC', houseId: 'h2', looseCards: [] } });
  assert.equal(state.houses[0].cemented, true);
  assert.deepEqual(new Set(state.houses[0].owners), new Set(['p0', 'p3']));
  assert.throws(
    () => playSeepTurn(state, { playerId: 'p2', action: { type: 'break', card: '2D', houseId: 'h2', newValue: 13 } }),
    /cemented_house_cannot_break|card_not_owned/,
  );

  state = playSeepTurn(state, { playerId: 'p2', action: { type: 'capture', card: 'QS', houseIds: ['h2'], looseGroups: [] } });
  assert.equal(state.houses.length, 0);
});

test('matching loose capture is mandatory and clearing the floor mid-hand scores a 50-point sweep', () => {
  let state = buildOpeningFixture();
  state = playSeepTurn(state, { playerId: 'p2', action: { type: 'capture', card: '9D', houseIds: ['h1'], looseGroups: [] } });
  state = playSeepTurn(state, { playerId: 'p1', action: { type: 'build', card: '6D', targetValue: 9, looseCards: ['3H'] } });
  state = playSeepTurn(state, { playerId: 'p0', action: { type: 'break', card: '3C', houseId: 'h2', newValue: 12 } });
  state = playSeepTurn(state, { playerId: 'p3', action: { type: 'cement', card: 'QC', houseId: 'h2', looseCards: [] } });
  state = playSeepTurn(state, { playerId: 'p2', action: { type: 'capture', card: 'QS', houseIds: ['h2'], looseGroups: [] } });
  assert.deepEqual([...state.floorLoose].sort(), ['10D', 'AS'].sort());
  assert.throws(() => playSeepTurn(state, { playerId: 'p1', action: { type: 'throw', card: 'JH' } }), /capture_required/);
  state = playSeepTurn(state, { playerId: 'p1', action: { type: 'capture', card: 'JH', houseIds: [], looseGroups: [['AS', '10D']] } });
  assert.equal(state.floorLoose.length, 0);
  assert.equal(state.sweepPoints[1], 50);
});

function findSubset(cards, target) {
  const chosen = [];
  function visit(index, sum) {
    if (sum === target) return true;
    if (sum > target || index >= cards.length) return false;
    for (let i = index; i < cards.length; i += 1) {
      chosen.push(cards[i]);
      if (visit(i + 1, sum + seepCardValue(cards[i]))) return true;
      chosen.pop();
    }
    return false;
  }
  return visit(0, 0) ? [...chosen] : null;
}

function captureGroups(cards, target) {
  let remaining = [...cards];
  const groups = [];
  while (true) {
    const group = findSubset(remaining, target);
    if (!group) return groups;
    groups.push(group);
    const remove = new Set(group);
    remaining = remaining.filter(card => !remove.has(card));
  }
}

test('deterministic no-house continuation finishes with exact deck custody and score conservation', () => {
  let state = buildOpeningFixture();
  state = playSeepTurn(state, { playerId: 'p2', action: { type: 'capture', card: '9D', houseIds: ['h1'], looseGroups: [] } });
  state = playSeepTurn(state, { playerId: 'p1', action: { type: 'build', card: '6D', targetValue: 9, looseCards: ['3H'] } });
  state = playSeepTurn(state, { playerId: 'p0', action: { type: 'break', card: '3C', houseId: 'h2', newValue: 12 } });
  state = playSeepTurn(state, { playerId: 'p3', action: { type: 'cement', card: 'QC', houseId: 'h2', looseCards: [] } });
  state = playSeepTurn(state, { playerId: 'p2', action: { type: 'capture', card: 'QS', houseIds: ['h2'], looseGroups: [] } });
  state = playSeepTurn(state, { playerId: 'p1', action: { type: 'capture', card: 'JH', houseIds: [], looseGroups: [['AS', '10D']] } });

  let guard = 0;
  while (state.phase !== 'finished') {
    guard += 1;
    assert.ok(guard < 60);
    const playerId = state.players[state.currentPlayerIndex];
    const card = state.hands[playerId][0];
    const value = seepCardValue(card);
    const groups = captureGroups(state.floorLoose, value);
    const houseIds = state.houses.filter(house => house.value === value).map(house => house.id);
    const action = groups.length > 0 || houseIds.length > 0
      ? { type: 'capture', card, houseIds, looseGroups: groups }
      : { type: 'throw', card };
    state = playSeepTurn(state, { playerId, action });
  }
  assert.equal(state.floorLoose.length, 0);
  assert.equal(state.houses.length, 0);
  assert.equal(state.capturedTeams[0].length + state.capturedTeams[1].length, 52);
  const score = scoreSeepHand(state);
  assert.equal(score.basePoints[0] + score.basePoints[1], 100);
});

test('match scoring handles 100-point lead and under-nine instant Baazi with dealer progression', () => {
  const lead = updateSeepMatch({ dealerIndex: 0, handScores: [90, 10], runningDifference: 30 });
  assert.equal(lead.baaziWinner, 0);
  assert.equal(lead.runningDifference, 0);
  assert.equal(lead.baazis[0], 1);

  const instant = updateSeepMatch({ dealerIndex: 0, handScores: [8, 92], runningDifference: 99 });
  assert.equal(instant.baaziWinner, 1);
  assert.equal(instant.runningDifference, 0);
});
