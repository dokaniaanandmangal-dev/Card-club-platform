const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const SUITS = ['C','D','H','S'];

export function buildTeenPattiDeck() {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ id: `${rank}${suit}`, rank, suit })));
}

export function validateTeenPattiDeck(deck) {
  if (!Array.isArray(deck) || deck.length !== 52) throw new Error('teen patti deck must contain exactly 52 cards');
  const canonicalDeck = buildTeenPattiDeck();
  const canonical = new Map(canonicalDeck.map((card) => [card.id, card]));
  const seen = new Set();
  for (const card of deck) {
    if (!card || typeof card !== 'object' || typeof card.id !== 'string' || typeof card.rank !== 'string' || typeof card.suit !== 'string') {
      throw new Error('invalid teen patti card');
    }
    const expected = canonical.get(card.id);
    if (!expected) throw new Error(`unknown teen patti card ${card.id}`);
    if (card.rank !== expected.rank || card.suit !== expected.suit) throw new Error(`teen patti card metadata mismatch ${card.id}`);
    if (seen.has(card.id)) throw new Error(`duplicate teen patti card ${card.id}`);
    seen.add(card.id);
  }
  return true;
}

export const TEEN_PATTI_RANKS = Object.freeze([...RANKS]);
export const TEEN_PATTI_SUITS = Object.freeze([...SUITS]);
