import { STANDARD_RANKS, TWENTY_NINE_RANKS } from './cards.js';

const base = Object.freeze({
  playerCount: 4,
  partnerships: true,
  requireFollowSuit: true,
  captureMode: 'winner',
});

export const TRICK_RULES = Object.freeze({
  spades: Object.freeze({
    ...base,
    id: 'spades',
    direction: 'clockwise',
    ranks: STANDARD_RANKS,
    fixedTrump: 'S',
    leadRestrictionSuit: 'S',
  }),
  hearts: Object.freeze({
    ...base,
    id: 'hearts',
    direction: 'clockwise',
    ranks: STANDARD_RANKS,
    partnerships: false,
    firstLeadCard: '2C',
    leadRestrictionSuit: 'H',
  }),
  '29': Object.freeze({
    ...base,
    id: '29',
    direction: 'clockwise',
    ranks: TWENTY_NINE_RANKS,
    requiresTrump: true,
    hiddenTrumpUntilVoidRequest: true,
  }),
  'court-piece': Object.freeze({
    ...base,
    id: 'court-piece',
    direction: 'anticlockwise',
    ranks: STANDARD_RANKS,
    requiresTrump: true,
  }),
  'dehla-pakad': Object.freeze({
    ...base,
    id: 'dehla-pakad',
    direction: 'anticlockwise',
    ranks: STANDARD_RANKS,
    requiresTrump: true,
    captureMode: 'consecutive-winner-pile',
  }),
});

export function getTrickRule(gameId) {
  const rule = TRICK_RULES[gameId];
  if (!rule) throw new Error('trick:unsupported_game');
  return rule;
}
