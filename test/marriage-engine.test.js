import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMarriageDeck, deriveMaalFamily } from '../src/game/marriage/cards.js';
import {
  MARRIAGE_RULES,
  createMarriageRound,
  declareQualification,
  discardCard,
  drawCard,
  evaluateQualification,
  projectMarriagePublic,
  projectMarriageSeat,
  revealMaal,
  scoreMarriageBonuses,
  validateMeld,
} from '../src/game/marriage/engine.js';

function card(deck, rank, suit) {
  return buildMarriageDeck({ includePrintedJokers: true }).find((entry) => entry.id === `D${deck}:${rank}${suit}`);
}

function arrangeTwoPlayerDeck({ hand0Ids = [], hand1Ids = [], maalId, includePrintedJokers = false }) {
  const base = buildMarriageDeck({ includePrintedJokers }).map((entry) => ({ ...entry }));
  const byId = new Map(base.map((entry) => [entry.id, entry]));
  const used = new Set([...hand0Ids, ...hand1Ids, maalId]);
  const filler = base.filter((entry) => !used.has(entry.id));
  const take = (ids) => {
    const result = ids.map((id) => byId.get(id));
    while (result.length < 21) result.push(filler.shift());
    return result;
  };
  const hand0 = take(hand0Ids);
  const hand1 = take(hand1Ids);
  const selectedMaal = byId.get(maalId);
  const remaining = base.filter((entry) => !new Set([...hand0, ...hand1, selectedMaal].map((value) => value.id)).has(entry.id));
  return [...hand0, ...hand1, selectedMaal, ...remaining];
}

test('approved Marriage constants lock owner-selected scoring and qualification', () => {
  assert.deepEqual(MARRIAGE_RULES.scores, {
    jhipluSingle: 2, tipluSingle: 3, popluSingle: 2,
    jhipluPair: 5, tipluPair: 10, popluPair: 5,
    marriage: 10, tunnela: 2, printedJoker: 1,
  });
  assert.equal(MARRIAGE_RULES.dubleesToQualify, 7);
  assert.equal(MARRIAGE_RULES.dubleesToFinish, 8);
});

test('Maal family uses same-suit adjacent ranks and scoring consumes marriages before residual pairs/singles', () => {
  const maal = card(1, '7', 'H');
  assert.deepEqual(deriveMaalFamily(maal), { suit: 'H', tipluRank: '7', jhipluRank: '6', popluRank: '8' });
  const hand = [
    card(1, '6', 'H'), card(1, '7', 'H'), card(1, '8', 'H'),
    card(2, '7', 'H'), card(3, '7', 'H'),
    card(1, '5', 'S'), card(2, '5', 'S'), card(3, '5', 'S'),
    buildMarriageDeck({ includePrintedJokers: true }).find((entry) => entry.id === 'D1:JOKER1'),
  ];
  const score = scoreMarriageBonuses(hand, maal);
  assert.equal(score.marriages, 1);
  assert.equal(score.maalPoints, 20); // marriage 10 + remaining Tiplu pair 10
  assert.equal(score.tunnelaPoints, 4); // Tiplu triplicate + 5S triplicate
  assert.equal(score.jokerPoints, 1);
  assert.equal(score.total, 25);
});

test('hidden Maal stays private until that seat proves three pure melds', () => {
  const qualificationIds = [
    'D1:2S','D1:3S','D1:4S',
    'D1:5H','D1:6H','D1:7H',
    'D1:8D','D1:9D','D1:10D',
  ];
  const deck = arrangeTwoPlayerDeck({ hand0Ids: qualificationIds, maalId: 'D1:QC' });
  let state = createMarriageRound({ players: [{ id: 'alice' }, { id: 'bob' }], deck, maalMode: 'hidden', dealerSeat: 1 });
  const groups = [
    { kind: 'pure_run', cardIds: qualificationIds.slice(0, 3) },
    { kind: 'pure_run', cardIds: qualificationIds.slice(3, 6) },
    { kind: 'pure_run', cardIds: qualificationIds.slice(6, 9) },
  ];
  assert.equal(projectMarriagePublic(state).maalCard, null);
  assert.equal(projectMarriageSeat(state, 0).maalCard, null);
  state = declareQualification(state, 0, groups);
  assert.equal(projectMarriageSeat(state, 0).maalCard, null);
  state = revealMaal(state, 0);
  assert.equal(projectMarriageSeat(state, 0).maalCard.id, 'D1:QC');
  assert.equal(projectMarriageSeat(state, 1).maalCard, null);
  assert.equal(projectMarriagePublic(state).maalCard, null);
});

test('seven Dublees qualify without awarding Dublee bonus points', () => {
  const hand = [];
  const groups = [];
  for (const [index, rank] of ['2','3','4','5','6','7','8'].entries()) {
    const pair = [card(1, rank, 'C'), card(2, rank, 'C')];
    hand.push(...pair);
    groups.push({ kind: 'dublee', cardIds: pair.map((entry) => entry.id) });
  }
  const result = evaluateQualification(hand, groups);
  assert.equal(result.dublees, 7);
  assert.equal(result.qualifies, true);
});

test('printed Joker is forbidden from pure melds but valid as an impure wildcard', () => {
  const deck = buildMarriageDeck({ includePrintedJokers: true });
  const joker = deck.find((entry) => entry.id === 'D1:JOKER1');
  const hand = [card(1, '4', 'S'), card(1, '6', 'S'), joker];
  const maal = card(1, '9', 'H');
  assert.equal(validateMeld(hand, { kind: 'pure_run', cardIds: hand.map((entry) => entry.id) }, { maalCard: maal, maalAccessible: true }), false);
  assert.equal(validateMeld(hand, { kind: 'impure_run', cardIds: hand.map((entry) => entry.id) }, { maalCard: maal, maalAccessible: true }), true);
});

test('draw/discard is server-authoritative, preserves 21-card hand and advances anticlockwise', () => {
  const deck = arrangeTwoPlayerDeck({ maalId: 'D1:AS' });
  let state = createMarriageRound({ players: [{ id: 'alice' }, { id: 'bob' }], deck, maalMode: 'open', dealerSeat: 1 });
  assert.equal(state.currentSeat, 0);
  const stockBefore = state.stock.length;
  state = drawCard(state, 0, 'stock');
  assert.equal(state.players[0].hand.length, 22);
  assert.equal(state.stock.length, stockBefore - 1);
  const discardId = state.players[0].hand[0].id;
  state = discardCard(state, 0, discardId);
  assert.equal(state.players[0].hand.length, 21);
  assert.equal(state.currentSeat, 1);
  assert.equal(state.turnStage, 'draw');
  assert.equal(projectMarriagePublic(state).players[0].handCount, 21);
});
