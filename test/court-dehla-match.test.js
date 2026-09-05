import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDeck, STANDARD_RANKS } from '../src/game/trick/cards.js';
import {
  createFiveCardTrumpSetup,
  chooseFiveCardTrump,
  completeFiveCardTrumpDeal,
  projectFiveCardTrumpSetup,
} from '../src/game/trick/five-card-trump-setup.js';
import { scoreCourtPieceDeal } from '../src/game/trick/court-piece-match.js';
import { scoreDehlaPakadHand } from '../src/game/trick/dehla-match.js';

const players = ['p0', 'p1', 'p2', 'p3'];

function deal(deck) {
  const hands = players.map(() => []);
  deck.forEach((card, i) => hands[i % 4].push(card));
  return hands;
}

function splitFiveEight() {
  const full = deal(makeDeck(STANDARD_RANKS));
  return { first: full.map(hand => hand.slice(0, 5)), remaining: full.map(hand => hand.slice(5)) };
}

test('Court Piece/Dehla five-card setup lets only dealer-right caller choose trump', () => {
  const { first, remaining } = splitFiveEight();
  for (const gameId of ['court-piece', 'dehla-pakad']) {
    let state = createFiveCardTrumpSetup({ gameId, players, firstFiveHands: first, dealerIndex: 0 });
    assert.equal(state.callerIndex, 3);
    assert.throws(() => chooseFiveCardTrump(state, { playerId: 'p0', trumpSuit: 'H' }), /only_caller/);
    const publicView = projectFiveCardTrumpSetup(state);
    assert.equal(publicView.seats.some(seat => Object.hasOwn(seat, 'hand')), false);
    const callerView = projectFiveCardTrumpSetup(state, 'p3');
    assert.deepEqual(callerView.seats[3].hand, first[3]);
    state = chooseFiveCardTrump(state, { playerId: 'p3', trumpSuit: 'H' });
    const setup = completeFiveCardTrumpDeal(state, { remainingHands: remaining });
    assert.equal(setup.trumpSuit, 'H');
    assert.equal(setup.leaderIndex, 3);
    assert.equal(new Set(setup.hands.flat()).size, 52);
  }
});

test('five-plus-eight completion rejects a duplicated or substituted deck', () => {
  const { first, remaining } = splitFiveEight();
  let state = createFiveCardTrumpSetup({ gameId: 'court-piece', players, firstFiveHands: first, dealerIndex: 1 });
  state = chooseFiveCardTrump(state, { playerId: 'p0', trumpSuit: 'S' });
  const bad = remaining.map(hand => [...hand]);
  bad[0][0] = bad[1][0];
  assert.throws(() => completeFiveCardTrumpDeal(state, { remainingHands: bad }), /duplicate_card|deck_mismatch/);
});

test('Court Piece majority wins deal; first-seven or seven-deal streak awards a court', () => {
  const ordinary = scoreCourtPieceDeal({
    players,
    dealerIndex: 0,
    trickWinnerIds: ['p3','p0','p3','p0','p3','p0','p3','p0','p3','p0','p3','p0','p3'],
  });
  assert.equal(ordinary.winnerTeam, 1);
  assert.equal(ordinary.courtAward, 0);
  assert.equal(ordinary.nextDealerIndex, 0);

  const firstSeven = scoreCourtPieceDeal({
    players,
    dealerIndex: 0,
    trickWinnerIds: ['p3','p1','p3','p1','p3','p1','p3','p0','p0','p0','p0','p0','p0'],
  });
  assert.equal(firstSeven.winnerTeam, 1);
  assert.equal(firstSeven.courtAward, 1);
  assert.equal(firstSeven.courtReason, 'first-seven');
  assert.equal(firstSeven.nextDealerIndex, 2);

  const streak = scoreCourtPieceDeal({
    players,
    dealerIndex: 0,
    trickWinnerIds: ['p3','p0','p3','p0','p3','p0','p3','p0','p3','p0','p3','p0','p3'],
    previousStreakTeam: 1,
    previousStreakDeals: 6,
  });
  assert.equal(streak.courtAward, 1);
  assert.equal(streak.courtReason, 'seven-deals');
});

test('Court Piece all thirteen tricks records a 52-court and resets streak', () => {
  const result = scoreCourtPieceDeal({
    players,
    dealerIndex: 0,
    trickWinnerIds: Array(13).fill('p0'),
    previousStreakTeam: 0,
    previousStreakDeals: 3,
    courts: [2, 1],
  });
  assert.equal(result.courtAward, 52);
  assert.equal(result.courts[0], 54);
  assert.equal(result.streakTeam, null);
  assert.equal(result.streakDeals, 0);
  assert.equal(result.nextDealerIndex, 3);
});

test('Dehla Pakad hand winner follows tens; four tens or seven consecutive hands awards a Kot', () => {
  const dealerTeamWin = scoreDehlaPakadHand({ dealerIndex: 0, tensByTeam: [3, 1] });
  assert.equal(dealerTeamWin.winnerTeam, 0);
  assert.equal(dealerTeamWin.kotAward, 0);
  assert.equal(dealerTeamWin.nextDealerIndex, 3);

  const twoTwo = scoreDehlaPakadHand({ dealerIndex: 0, tensByTeam: [2, 2] });
  assert.equal(twoTwo.winnerTeam, 1);
  assert.equal(twoTwo.nextDealerIndex, 0);

  const fourTens = scoreDehlaPakadHand({ dealerIndex: 0, tensByTeam: [0, 4], kots: [0, 2] });
  assert.equal(fourTens.kotAward, 1);
  assert.equal(fourTens.kotReason, 'four-tens');
  assert.deepEqual(fourTens.kots, [0, 3]);
  assert.equal(fourTens.nextDealerIndex, 2);

  const streak = scoreDehlaPakadHand({
    dealerIndex: 0,
    tensByTeam: [2, 2],
    previousStreakTeam: 1,
    previousStreakHands: 6,
  });
  assert.equal(streak.kotAward, 1);
  assert.equal(streak.kotReason, 'seven-hands');
  assert.equal(streak.streakTeam, null);
});
