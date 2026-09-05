import { STANDARD_RANKS, makeDeck, parseCard } from '../trick/cards.js';

export const SEEP_DECK = makeDeck(STANDARD_RANKS);

export function seepCardValue(card) {
  const { rank } = parseCard(card, STANDARD_RANKS);
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  return Number(rank);
}

export function seepCardPoints(card) {
  const { rank, suit } = parseCard(card, STANDARD_RANKS);
  if (suit === 'S') return seepCardValue(card);
  if (rank === 'A') return 1;
  if (card === '10D') return 6;
  return 0;
}
