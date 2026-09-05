const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const SUITS = ['C','D','H','S'];

export function buildHoldemDeck() {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ id: `${rank}${suit}`, rank, suit })));
}

export function validateHoldemDeck(deck) {
  if (!Array.isArray(deck) || deck.length !== 52) throw new Error('holdem deck must contain exactly 52 cards');
  const canonical = new Set(buildHoldemDeck().map((card) => card.id));
  const seen = new Set();
  for (const card of deck) {
    if (!card || typeof card !== 'object' || typeof card.id !== 'string' || typeof card.rank !== 'string' || typeof card.suit !== 'string') {
      throw new Error('invalid holdem card');
    }
    if (!canonical.has(card.id)) throw new Error(`unknown holdem card ${card.id}`);
    const expected = buildHoldemDeck().find((entry) => entry.id === card.id);
    if (card.rank !== expected.rank || card.suit !== expected.suit) throw new Error(`holdem card metadata mismatch ${card.id}`);
    if (seen.has(card.id)) throw new Error(`duplicate holdem card ${card.id}`);
    seen.add(card.id);
  }
  return true;
}

export const HOLDEM_RANKS = Object.freeze([...RANKS]);
export const HOLDEM_SUITS = Object.freeze([...SUITS]);
