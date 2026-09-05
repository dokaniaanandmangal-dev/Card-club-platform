export const SUITS = Object.freeze(['S', 'H', 'D', 'C']);
export const RANKS = Object.freeze(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);

function naturalCard(deck, rank, suit) {
  return Object.freeze({ id: `D${deck}:${rank}${suit}`, deck, rank, suit, printedJoker: false });
}

function jokerCard(deck, copy) {
  return Object.freeze({ id: `D${deck}:JOKER${copy}`, deck, rank: null, suit: null, printedJoker: true });
}

export function buildMarriageDeck({ includePrintedJokers = false } = {}) {
  const cards = [];
  for (let deck = 1; deck <= 3; deck += 1) {
    for (const suit of SUITS) for (const rank of RANKS) cards.push(naturalCard(deck, rank, suit));
    if (includePrintedJokers) {
      cards.push(jokerCard(deck, 1));
      cards.push(jokerCard(deck, 2));
    }
  }
  return Object.freeze(cards);
}

export function assertExactMarriageDeck(deck, { includePrintedJokers = false } = {}) {
  if (!Array.isArray(deck)) throw new Error('marriage:deck_required');
  const expected = buildMarriageDeck({ includePrintedJokers });
  if (deck.length !== expected.length) throw new Error('marriage:deck_size');
  const expectedById = new Map(expected.map((card) => [card.id, card]));
  const seen = new Set();
  for (const card of deck) {
    if (!card || typeof card !== 'object' || typeof card.id !== 'string') throw new Error('marriage:invalid_card');
    if (seen.has(card.id)) throw new Error('marriage:duplicate_card');
    seen.add(card.id);
    const canonical = expectedById.get(card.id);
    if (!canonical) throw new Error('marriage:unknown_card');
    if (card.deck !== canonical.deck || card.rank !== canonical.rank || card.suit !== canonical.suit || card.printedJoker !== canonical.printedJoker) {
      throw new Error('marriage:card_metadata_mismatch');
    }
  }
  return true;
}

export function rankIndex(rank) {
  const index = RANKS.indexOf(rank);
  if (index < 0) throw new Error('marriage:invalid_rank');
  return index;
}

export function deriveMaalFamily(maalCard) {
  if (!maalCard || maalCard.printedJoker || !RANKS.includes(maalCard.rank) || !SUITS.includes(maalCard.suit)) {
    throw new Error('marriage:maal_must_be_natural');
  }
  const index = rankIndex(maalCard.rank);
  const jhipluRank = RANKS[(index - 1 + RANKS.length) % RANKS.length];
  const popluRank = RANKS[(index + 1) % RANKS.length];
  return Object.freeze({
    suit: maalCard.suit,
    tipluRank: maalCard.rank,
    jhipluRank,
    popluRank,
  });
}

export function maalRole(card, family) {
  if (!card || card.printedJoker || card.suit !== family.suit) return null;
  if (card.rank === family.tipluRank) return 'tiplu';
  if (card.rank === family.jhipluRank) return 'jhiplu';
  if (card.rank === family.popluRank) return 'poplu';
  return null;
}
