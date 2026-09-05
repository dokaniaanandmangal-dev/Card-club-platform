const VALUE = Object.freeze({ '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,J:11,Q:12,K:13,A:14 });
const CATEGORY = Object.freeze(['high_card','pair','two_pair','trips','straight','flush','full_house','quads','straight_flush']);

function compareTuple(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const delta = (a[i] ?? -1) - (b[i] ?? -1);
    if (delta !== 0) return Math.sign(delta);
  }
  return 0;
}

function straightHigh(values) {
  const unique = [...new Set(values)].sort((a,b) => b-a);
  if (unique.includes(14)) unique.push(1);
  let run = 1;
  for (let i = 1; i < unique.length; i += 1) {
    if (unique[i - 1] - unique[i] === 1) run += 1;
    else run = 1;
    if (run >= 5) return unique[i - 4];
  }
  return null;
}

export function evaluateFive(cards) {
  if (!Array.isArray(cards) || cards.length !== 5) throw new Error('evaluateFive requires exactly five cards');
  const values = cards.map((card) => VALUE[card.rank]).sort((a,b) => b-a);
  if (values.some((value) => !Number.isInteger(value))) throw new Error('invalid rank');
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const straight = straightHigh(values);
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a,b) => b[1] - a[1] || b[0] - a[0]);

  let tuple;
  if (flush && straight) tuple = [8, straight];
  else if (groups[0][1] === 4) tuple = [7, groups[0][0], groups[1][0]];
  else if (groups[0][1] === 3 && groups[1][1] === 2) tuple = [6, groups[0][0], groups[1][0]];
  else if (flush) tuple = [5, ...values];
  else if (straight) tuple = [4, straight];
  else if (groups[0][1] === 3) tuple = [3, groups[0][0], ...groups.slice(1).map(([value]) => value).sort((a,b) => b-a)];
  else if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = [groups[0][0], groups[1][0]].sort((a,b) => b-a);
    const kicker = groups.find(([,count]) => count === 1)[0];
    tuple = [2, ...pairs, kicker];
  } else if (groups[0][1] === 2) {
    tuple = [1, groups[0][0], ...groups.slice(1).map(([value]) => value).sort((a,b) => b-a)];
  } else tuple = [0, ...values];
  return Object.freeze({ category: CATEGORY[tuple[0]], tuple: Object.freeze(tuple), cards: Object.freeze(cards.map((card) => card.id)) });
}

function combinations(cards, choose, start = 0, prefix = [], output = []) {
  if (prefix.length === choose) {
    output.push(prefix);
    return output;
  }
  for (let i = start; i <= cards.length - (choose - prefix.length); i += 1) {
    combinations(cards, choose, i + 1, [...prefix, cards[i]], output);
  }
  return output;
}

export function evaluateBest(cards) {
  if (!Array.isArray(cards) || cards.length < 5 || cards.length > 7) throw new Error('evaluateBest requires five to seven cards');
  let best = null;
  for (const combo of combinations(cards, 5)) {
    const value = evaluateFive(combo);
    if (!best || compareTuple(value.tuple, best.tuple) > 0) best = value;
  }
  return best;
}

export function compareHands(a, b) {
  return compareTuple(a.tuple, b.tuple);
}
