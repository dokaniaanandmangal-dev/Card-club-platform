export const SUITS = Object.freeze(['C', 'D', 'H', 'S']);
export const STANDARD_RANKS = Object.freeze(['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2']);
export const TWENTY_NINE_RANKS = Object.freeze(['J', '9', 'A', '10', 'K', 'Q', '8', '7']);

const CARD_RE = /^(10|[2-9JQKA])([CDHS])$/;

export function parseCard(card, ranks = STANDARD_RANKS) {
  if (typeof card !== 'string') throw new Error('card:invalid');
  const match = CARD_RE.exec(card);
  if (!match || !ranks.includes(match[1])) throw new Error('card:invalid');
  return Object.freeze({ rank: match[1], suit: match[2] });
}

export function makeDeck(ranks = STANDARD_RANKS) {
  return Object.freeze(SUITS.flatMap(suit => ranks.map(rank => `${rank}${suit}`)));
}

export function cardBeats(candidate, incumbent, { leadSuit, trumpSuit = null, trumpActive = false, ranks }) {
  const left = parseCard(candidate, ranks);
  const right = parseCard(incumbent, ranks);
  if (trumpActive && trumpSuit) {
    if (left.suit === trumpSuit && right.suit !== trumpSuit) return true;
    if (left.suit !== trumpSuit && right.suit === trumpSuit) return false;
  }
  if (left.suit !== right.suit) {
    if (left.suit === leadSuit && right.suit !== leadSuit) return true;
    return false;
  }
  return ranks.indexOf(left.rank) < ranks.indexOf(right.rank);
}
