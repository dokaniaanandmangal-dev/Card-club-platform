import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDeck, STANDARD_RANKS, TWENTY_NINE_RANKS } from '../src/game/trick/cards.js';
import {
  createTrickPlayState,
  getLegalCards,
  playCard,
  projectTrickState,
  requestTrumpReveal,
  summarizeTrickHand,
} from '../src/game/trick/engine.js';

const players = ['p0', 'p1', 'p2', 'p3'];

function deal(deck) {
  const hands = players.map(() => []);
  deck.forEach((card, index) => hands[index % 4].push(card));
  return hands;
}

function stateFor(gameId, { deck, trumpSuit = null, leaderIndex = 0, options = {} } = {}) {
  const ranks = gameId === '29' ? TWENTY_NINE_RANKS : STANDARD_RANKS;
  return createTrickPlayState({
    gameId,
    players,
    hands: deal(deck ?? makeDeck(ranks)),
    leaderIndex,
    trumpSuit,
    options,
  });
}

test('rejects duplicate/missing cards and out-of-turn play', () => {
  const deck = [...makeDeck(STANDARD_RANKS)];
  deck[1] = deck[0];
  assert.throws(() => stateFor('spades', { deck }), /duplicate_card/);
  const valid = stateFor('spades');
  assert.throws(() => playCard(valid, { playerId: 'p1', card: valid.hands.p1[0] }), /out_of_turn/);
});

test('spades enforces follow-suit and cannot lead trump before broken unless forced', () => {
  let state = stateFor('spades');
  assert.equal(getLegalCards(state, 'p0').some(card => card.endsWith('S')), false);
  const lead = getLegalCards(state, 'p0')[0];
  state = playCard(state, { playerId: 'p0', card: lead });
  const leadSuit = lead.at(-1);
  const follower = 'p1';
  const offSuit = state.hands[follower].find(card => !card.endsWith(leadSuit));
  if (offSuit && state.hands[follower].some(card => card.endsWith(leadSuit))) {
    assert.throws(() => playCard(state, { playerId: follower, card: offSuit }), /must_follow_suit/);
  }
});

test('hearts requires 2C on the first lead and keeps hearts unleadable until broken', () => {
  const hands = deal(makeDeck(STANDARD_RANKS));
  const holder = hands.findIndex(hand => hand.includes('2C'));
  let state = createTrickPlayState({ gameId: 'hearts', players, hands, leaderIndex: holder });
  assert.deepEqual(getLegalCards(state, players[holder]), ['2C']);
  state = playCard(state, { playerId: players[holder], card: '2C' });
  assert.equal(state.trick[0].card, '2C');
});

test('29 keeps selected trump hidden and forces a void player to request reveal before discarding', () => {
  const clubs = TWENTY_NINE_RANKS.map(rank => `${rank}C`);
  const diamonds = TWENTY_NINE_RANKS.map(rank => `${rank}D`);
  const hearts = TWENTY_NINE_RANKS.map(rank => `${rank}H`);
  const spades = TWENTY_NINE_RANKS.map(rank => `${rank}S`);
  let state = createTrickPlayState({
    gameId: '29',
    players,
    hands: [clubs, diamonds, hearts, spades],
    leaderIndex: 0,
    trumpSuit: 'H',
  });
  assert.equal(state.trumpRevealed, false);
  state = playCard(state, { playerId: 'p0', card: 'JC' });
  assert.deepEqual(getLegalCards(state, 'p1'), []);
  assert.throws(() => playCard(state, { playerId: 'p1', card: 'JD' }), /reveal_trump_required/);
  state = requestTrumpReveal(state, { playerId: 'p1' });
  assert.equal(state.trumpRevealed, true);
  assert.ok(getLegalCards(state, 'p1').includes('JD'));
});

test('court piece uses active trump and anticlockwise turn order', () => {
  let state = stateFor('court-piece', { trumpSuit: 'H' });
  const first = getLegalCards(state, 'p0')[0];
  state = playCard(state, { playerId: 'p0', card: first });
  assert.equal(state.players[state.currentPlayerIndex], 'p3');
  assert.equal(state.trumpRevealed, true);
});

test('Dehla Pakad accumulates the centre until the same player wins consecutive tricks or the hand ends', () => {
  let state = stateFor('dehla-pakad', { trumpSuit: 'S' });
  while (!state.finished && state.completedTricks.length < 2) {
    const current = state.players[state.currentPlayerIndex];
    const card = getLegalCards(state, current)[0];
    state = playCard(state, { playerId: current, card });
  }
  const captured = Object.values(state.captured).reduce((sum, cards) => sum + cards.length, 0);
  assert.equal(captured + state.centerPile.length, state.completedTricks.length * 4);
});

test('viewer projection exposes only the viewer hand and never opponent cards or hidden trump', () => {
  const state = stateFor('spades');
  const projection = projectTrickState(state, 'p2');
  assert.deepEqual(projection.seats.find(seat => seat.playerId === 'p2').hand, state.hands.p2);
  for (const seat of projection.seats.filter(seat => seat.playerId !== 'p2')) {
    assert.equal(Object.hasOwn(seat, 'hand'), false);
  }
  const publicProjection = projectTrickState(state);
  assert.equal(publicProjection.seats.some(seat => Object.hasOwn(seat, 'hand')), false);

  const hidden29 = stateFor('29', { trumpSuit: 'D' });
  assert.equal(projectTrickState(hidden29).trumpSuit, null);
});

function shuffled(deck, seed) {
  const out = [...deck];
  let state = seed >>> 0;
  const rand = max => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % max;
  };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = rand(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function runToCompletion(gameId, seed) {
  const ranks = gameId === '29' ? TWENTY_NINE_RANKS : STANDARD_RANKS;
  const trumpSuit = ['29', 'court-piece', 'dehla-pakad'].includes(gameId) ? 'D' : null;
  const deck = shuffled(makeDeck(ranks), seed);
  const hands = deal(deck);
  let leaderIndex = 0;
  if (gameId === 'hearts') leaderIndex = hands.findIndex(hand => hand.includes('2C'));
  let state = createTrickPlayState({ gameId, players, hands, leaderIndex, trumpSuit });
  let safety = 0;
  while (!state.finished) {
    safety += 1;
    assert.ok(safety < 100);
    const current = state.players[state.currentPlayerIndex];
    let legal = getLegalCards(state, current);
    if (legal.length === 0 && gameId === '29' && state.trick.length > 0 && !state.trumpRevealed) {
      state = requestTrumpReveal(state, { playerId: current });
      legal = getLegalCards(state, current);
    }
    assert.ok(legal.length > 0);
    state = playCard(state, { playerId: current, card: legal[0] });
  }
  const captured = Object.values(state.captured).reduce((sum, cards) => sum + cards.length, 0);
  assert.equal(captured, makeDeck(ranks).length);
  assert.equal(state.centerPile.length, 0);
  return state;
}

test('2,500 deterministic complete-hand simulations preserve turn, ownership, follow-suit and capture invariants', () => {
  const games = ['spades', 'hearts', '29', 'court-piece', 'dehla-pakad'];
  for (let i = 0; i < 500; i += 1) {
    for (const [offset, gameId] of games.entries()) runToCompletion(gameId, 0x51a7 + i * 31 + offset);
  }
});

test('completed-hand summaries preserve each game family scoring substrate', () => {
  const spades = summarizeTrickHand(runToCompletion('spades', 101));
  assert.equal(spades.teamTricks[0] + spades.teamTricks[1], 13);

  const hearts = summarizeTrickHand(runToCompletion('hearts', 102));
  assert.equal(Object.values(hearts.penalties).reduce((a, b) => a + b, 0), 26);

  const twentyNine = summarizeTrickHand(runToCompletion('29', 103));
  assert.equal(twentyNine.teamPoints[0] + twentyNine.teamPoints[1], 28);

  const court = summarizeTrickHand(runToCompletion('court-piece', 104));
  assert.equal(court.teamTricks[0] + court.teamTricks[1], 13);
  assert.ok(court.handWinner === 0 || court.handWinner === 1);

  const dehla = summarizeTrickHand(runToCompletion('dehla-pakad', 105));
  assert.equal(dehla.tens[0] + dehla.tens[1], 4);
});
