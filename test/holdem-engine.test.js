import assert from 'node:assert/strict';
import test from 'node:test';

import { buildHoldemDeck, validateHoldemDeck } from '../src/game/holdem/cards.js';
import { evaluateBest } from '../src/game/holdem/evaluator.js';
import { actHoldem, buildSidePots, createHoldemHand, projectHoldemPublic, projectHoldemSeat } from '../src/game/holdem/engine.js';

function fixedDeck(frontIds = []) {
  const deck = buildHoldemDeck();
  const byId = new Map(deck.map((card) => [card.id, card]));
  const used = new Set(frontIds);
  return [...frontIds.map((id) => byId.get(id)), ...deck.filter((card) => !used.has(card.id))];
}
function players(stacks = [1000,1000,1000]) { return stacks.map((stack, seat) => ({ id:`p${seat}`, seat, stack })); }

test('heads-up blinds and preflop action follow Holdem position rules', () => {
  const state = createHoldemHand({ players: players([100,100]).slice(0,2), dealerSeat:0, smallBlind:5, bigBlind:10 });
  assert.equal(state.smallBlindSeat, 0);
  assert.equal(state.bigBlindSeat, 1);
  assert.equal(state.currentSeat, 0);
  assert.equal(state.players[0].streetContribution, 5);
  assert.equal(state.players[1].streetContribution, 10);
});

test('exact 52-card custody rejects duplicate or substituted decks', () => {
  const duplicate = buildHoldemDeck();
  duplicate[51] = { ...duplicate[0] };
  assert.throws(() => validateHoldemDeck(duplicate), /duplicate/);
  const altered = buildHoldemDeck();
  altered[0] = { id:'2C', rank:'A', suit:'C' };
  assert.throws(() => validateHoldemDeck(altered), /metadata mismatch/);
});

test('public projection hides all hole cards while seat projection reveals only own cards', () => {
  const state = createHoldemHand({ players: players(), dealerSeat:0, smallBlind:5, bigBlind:10 });
  assert.equal(projectHoldemPublic(state).players.every((player) => player.hole === null), true);
  const view = projectHoldemSeat(state, 1);
  assert.equal(view.players[1].hole.length, 2);
  assert.equal(view.players[0].hole, null);
  assert.equal(view.players[2].hole, null);
});

test('minimum no-limit raise is enforced and full raise reopens action', () => {
  let state = createHoldemHand({ players: players(), dealerSeat:0, smallBlind:5, bigBlind:10 });
  assert.equal(state.currentSeat, 0);
  assert.throws(() => actHoldem(state, 0, { type:'raise', to:15 }), /below minimum/);
  state = actHoldem(state, 0, { type:'raise', to:20 });
  assert.equal(state.currentBet, 20);
  assert.equal(state.lastFullRaiseSize, 10);
  state = actHoldem(state, 1, { type:'call' });
  state = actHoldem(state, 2, { type:'raise', to:40 });
  assert.equal(state.currentBet, 40);
  assert.equal(state.currentSeat, 0);
});

test('short all-in raise does not reopen raising for a player who already acted', () => {
  let state = createHoldemHand({ players: players([100,100,25]), dealerSeat:0, smallBlind:5, bigBlind:10 });
  state = actHoldem(state, 0, { type:'raise', to:20 });
  state = actHoldem(state, 1, { type:'call' });
  state = actHoldem(state, 2, { type:'all_in' });
  assert.equal(state.currentBet, 25);
  assert.equal(state.currentSeat, 0);
  assert.throws(() => actHoldem(state, 0, { type:'raise', to:40 }), /not reopened/);
  state = actHoldem(state, 0, { type:'call' });
  state = actHoldem(state, 1, { type:'call' });
  assert.equal(state.street, 'flop');
});

test('side pots conserve unequal all-in contributions', () => {
  const pots = buildSidePots([
    { seat:0, totalContribution:100, status:'all_in' },
    { seat:1, totalContribution:200, status:'all_in' },
    { seat:2, totalContribution:300, status:'active' },
    { seat:3, totalContribution:300, status:'folded' },
  ]);
  assert.deepEqual(pots, [
    { amount:400, eligibleSeats:[0,1,2] },
    { amount:300, eligibleSeats:[1,2] },
    { amount:200, eligibleSeats:[2] },
  ]);
  assert.equal(pots.reduce((sum,pot) => sum+pot.amount,0), 900);
});

test('best-of-seven evaluator handles wheel straight and full house ordering', () => {
  const deck = new Map(buildHoldemDeck().map((card) => [card.id,card]));
  const wheel = evaluateBest(['AS','2D','3C','4H','5S','KD','QC'].map((id)=>deck.get(id)));
  const fullHouse = evaluateBest(['AH','AD','AC','KS','KD','2C','3D'].map((id)=>deck.get(id)));
  assert.equal(wheel.category, 'straight');
  assert.deepEqual(wheel.tuple, [4,5]);
  assert.equal(fullHouse.category, 'full_house');
});

test('fold win awards the complete pot and preserves chip total', () => {
  let state = createHoldemHand({ players: players(), dealerSeat:0, smallBlind:5, bigBlind:10 });
  const initial = state.initialChipTotal;
  state = actHoldem(state, 0, { type:'fold' });
  state = actHoldem(state, 1, { type:'fold' });
  assert.equal(state.status, 'complete');
  assert.equal(state.result.reason, 'all_others_folded');
  assert.equal(state.players.reduce((sum,p)=>sum+p.stack,0), initial);
});

test('deterministic all-in showdown pays main and side pots independently', () => {
  const deck = fixedDeck([
    'KS','QS','AS','KH','QH','AH',
    '5C','2C','3D','4H','6C','8S','7C','9H',
  ]);
  let state = createHoldemHand({ players: players([50,100,100]), dealerSeat:0, smallBlind:5, bigBlind:10, deck });
  state = actHoldem(state, 0, { type:'all_in' });
  state = actHoldem(state, 1, { type:'call' });
  state = actHoldem(state, 2, { type:'raise', to:100 });
  state = actHoldem(state, 1, { type:'call' });
  assert.equal(state.status, 'complete');
  assert.equal(state.board.length, 5);
  assert.deepEqual(state.pots.map((pot) => ({ amount:pot.amount, winners:pot.winners })), [
    { amount:150, winners:[0] },
    { amount:100, winners:[1] },
  ]);
  assert.deepEqual(state.players.map((player) => player.stack), [150,100,0]);
  assert.equal(state.players.reduce((sum,p)=>sum+p.stack,0), state.initialChipTotal);
  const pub = projectHoldemPublic(state);
  assert.equal(pub.players.every((player) => Array.isArray(player.hole)), true);
});

test('10,000 deterministic seven-card permutations produce identical rankings', () => {
  const deck = buildHoldemDeck();
  let seed = 0x5eed1234;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let i = 0; i < 10_000; i += 1) {
    const pool = deck.map((card) => card);
    const hand = [];
    for (let j = 0; j < 7; j += 1) hand.push(pool.splice(next() % pool.length, 1)[0]);
    const a = evaluateBest(hand);
    const b = evaluateBest([...hand].reverse());
    assert.deepEqual(a.tuple, b.tuple);
    assert.equal(a.category, b.category);
  }
});
