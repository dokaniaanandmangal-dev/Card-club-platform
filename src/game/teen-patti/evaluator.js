import { TEEN_PATTI_RANKS } from './cards.js';

const RANK_VALUE = new Map(TEEN_PATTI_RANKS.map((rank, index) => [rank, index + 2]));
const CATEGORY = Object.freeze({ high: 1, pair: 2, color: 3, sequence: 4, pureSequence: 5, trail: 6 });

function assertHand(cards) {
  if (!Array.isArray(cards) || cards.length !== 3) throw new Error('teen patti hand must contain exactly three cards');
  const ids = new Set(cards.map((card) => card?.id));
  if (ids.size !== 3 || cards.some((card) => !RANK_VALUE.has(card?.rank) || !['C','D','H','S'].includes(card?.suit))) {
    throw new Error('invalid teen patti hand');
  }
}

function sequenceStrength(values) {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.length !== 3) return 0;
  // Classic baseline: A-K-Q highest, A-2-3 second-highest, then K-Q-J down to 4-3-2.
  if (unique[0] === 14 && unique[1] === 13 && unique[2] === 12) return 100;
  if (unique[0] === 14 && unique[1] === 3 && unique[2] === 2) return 99;
  if (unique[0] - 1 === unique[1] && unique[1] - 1 === unique[2]) return unique[0];
  return 0;
}

export function evaluateTeenPattiHand(cards) {
  assertHand(cards);
  const values = cards.map((card) => RANK_VALUE.get(card.rank));
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const seq = sequenceStrength(values);
  const sorted = [...values].sort((a, b) => b - a);

  if (groups[0][1] === 3) return Object.freeze({ category: 'trail', categoryValue: CATEGORY.trail, tiebreak: [groups[0][0]] });
  if (flush && seq) return Object.freeze({ category: 'pure_sequence', categoryValue: CATEGORY.pureSequence, tiebreak: [seq] });
  if (seq) return Object.freeze({ category: 'sequence', categoryValue: CATEGORY.sequence, tiebreak: [seq] });
  if (flush) return Object.freeze({ category: 'color', categoryValue: CATEGORY.color, tiebreak: sorted });
  if (groups[0][1] === 2) {
    const pairRank = groups[0][0];
    const kicker = groups.find((group) => group[1] === 1)[0];
    return Object.freeze({ category: 'pair', categoryValue: CATEGORY.pair, tiebreak: [pairRank, kicker] });
  }
  return Object.freeze({ category: 'high_card', categoryValue: CATEGORY.high, tiebreak: sorted });
}

export function compareTeenPattiHands(leftCards, rightCards) {
  const left = evaluateTeenPattiHand(leftCards);
  const right = evaluateTeenPattiHand(rightCards);
  if (left.categoryValue !== right.categoryValue) return Math.sign(left.categoryValue - right.categoryValue);
  const length = Math.max(left.tiebreak.length, right.tiebreak.length);
  for (let i = 0; i < length; i += 1) {
    const delta = (left.tiebreak[i] ?? 0) - (right.tiebreak[i] ?? 0);
    if (delta !== 0) return Math.sign(delta);
  }
  return 0;
}

export const TEEN_PATTI_CATEGORY_ORDER = Object.freeze(['high_card','pair','color','sequence','pure_sequence','trail']);
