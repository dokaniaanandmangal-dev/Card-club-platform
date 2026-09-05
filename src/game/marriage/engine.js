import { assertExactMarriageDeck, deriveMaalFamily, maalRole, rankIndex } from './cards.js';

export const MARRIAGE_RULES = Object.freeze({
  cardsPerPlayer: 21,
  minPlayers: 2,
  maxPlayers: 5,
  pureMeldsToQualify: 3,
  dubleesToQualify: 7,
  dubleesToFinish: 8,
  scores: Object.freeze({
    jhipluSingle: 2,
    tipluSingle: 3,
    popluSingle: 2,
    jhipluPair: 5,
    tipluPair: 10,
    popluPair: 5,
    marriage: 10,
    tunnela: 2,
    printedJoker: 1,
  }),
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function assertSeat(state, seat) {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.players.length) throw new Error('marriage:invalid_seat');
}

function assertPlayers(players) {
  if (!Array.isArray(players) || players.length < MARRIAGE_RULES.minPlayers || players.length > MARRIAGE_RULES.maxPlayers) {
    throw new Error('marriage:player_count');
  }
  const ids = new Set();
  for (const player of players) {
    if (!player || typeof player.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(player.id)) throw new Error('marriage:invalid_player');
    if (ids.has(player.id)) throw new Error('marriage:duplicate_player');
    ids.add(player.id);
  }
}

function findMaalIndex(stock) {
  const index = stock.findIndex((card) => !card.printedJoker);
  if (index < 0) throw new Error('marriage:no_natural_maal');
  return index;
}

export function createMarriageRound({ players, deck, maalMode = 'open', includePrintedJokers = false, dealerSeat = 0 }) {
  assertPlayers(players);
  if (!['open', 'hidden'].includes(maalMode)) throw new Error('marriage:invalid_maal_mode');
  if (!Number.isInteger(dealerSeat) || dealerSeat < 0 || dealerSeat >= players.length) throw new Error('marriage:invalid_dealer');
  assertExactMarriageDeck(deck, { includePrintedJokers });

  const working = deck.map((card) => ({ ...card }));
  const seats = players.map((player) => ({ id: player.id, hand: [] }));
  for (let seat = 0; seat < seats.length; seat += 1) {
    seats[seat].hand = working.splice(0, MARRIAGE_RULES.cardsPerPlayer);
  }
  const maalIndex = findMaalIndex(working);
  const [maalCard] = working.splice(maalIndex, 1);
  const currentSeat = (dealerSeat - 1 + seats.length) % seats.length;
  return deepFreeze({
    game: 'marriage-21',
    maalMode,
    includePrintedJokers,
    dealerSeat,
    currentSeat,
    turnStage: 'draw',
    players: seats,
    stock: working,
    discardPile: [],
    maalCard,
    qualifiedSeats: [],
    maalSeenBy: maalMode === 'open' ? seats.map((_, seat) => seat) : [],
    winnerSeat: null,
    actionNumber: 0,
  });
}

function cardMap(hand) {
  return new Map(hand.map((card) => [card.id, card]));
}

function resolveCards(hand, cardIds) {
  if (!Array.isArray(cardIds) || cardIds.length === 0) throw new Error('marriage:empty_group');
  const map = cardMap(hand);
  const used = new Set();
  return cardIds.map((id) => {
    if (typeof id !== 'string' || used.has(id)) throw new Error('marriage:duplicate_group_card');
    used.add(id);
    const card = map.get(id);
    if (!card) throw new Error('marriage:card_not_owned');
    return card;
  });
}

export function isDublee(cards) {
  return cards.length === 2 && cards.every((card) => !card.printedJoker) && cards[0].rank === cards[1].rank && cards[0].suit === cards[1].suit && cards[0].deck !== cards[1].deck;
}

function isTunnela(cards) {
  return cards.length === 3 && cards.every((card) => !card.printedJoker) && new Set(cards.map((card) => card.deck)).size === 3 && cards.every((card) => card.rank === cards[0].rank && card.suit === cards[0].suit);
}

function isPureSet(cards) {
  if (cards.length < 3 || cards.length > 4 || cards.some((card) => card.printedJoker)) return false;
  return cards.every((card) => card.rank === cards[0].rank) && new Set(cards.map((card) => card.suit)).size === cards.length;
}

function isPureRun(cards) {
  if (cards.length < 3 || cards.some((card) => card.printedJoker)) return false;
  if (!cards.every((card) => card.suit === cards[0].suit)) return false;
  const ranks = cards.map((card) => rankIndex(card.rank)).sort((a, b) => a - b);
  if (new Set(ranks).size !== ranks.length) return false;
  return ranks.every((rank, index) => index === 0 || rank === ranks[index - 1] + 1);
}

export function validatePureGroup(hand, group) {
  const cards = resolveCards(hand, group.cardIds);
  if (group.kind === 'tunnela') return isTunnela(cards);
  if (group.kind === 'pure_set') return isPureSet(cards);
  if (group.kind === 'pure_run') return isPureRun(cards);
  return false;
}

function isWild(card, family, maalAccessible) {
  if (card.printedJoker) return true;
  return maalAccessible && Boolean(maalRole(card, family));
}

function isImpureSet(cards, family, maalAccessible) {
  if (cards.length < 3 || cards.length > 4) return false;
  const naturals = cards.filter((card) => !isWild(card, family, maalAccessible));
  const wildCount = cards.length - naturals.length;
  if (wildCount < 1 || naturals.length === 0) return false;
  return naturals.every((card) => card.rank === naturals[0].rank) && new Set(naturals.map((card) => card.suit)).size === naturals.length;
}

function isImpureRun(cards, family, maalAccessible) {
  if (cards.length < 3) return false;
  const naturals = cards.filter((card) => !isWild(card, family, maalAccessible));
  const wildCount = cards.length - naturals.length;
  if (wildCount < 1 || naturals.length === 0 || !naturals.every((card) => card.suit === naturals[0].suit)) return false;
  const ranks = naturals.map((card) => rankIndex(card.rank)).sort((a, b) => a - b);
  if (new Set(ranks).size !== ranks.length) return false;
  const gaps = ranks[ranks.length - 1] - ranks[0] + 1 - ranks.length;
  return gaps <= wildCount && ranks[ranks.length - 1] - ranks[0] + 1 <= cards.length;
}

export function validateMeld(hand, group, { maalCard = null, maalAccessible = false } = {}) {
  const cards = resolveCards(hand, group.cardIds);
  if (['tunnela', 'pure_set', 'pure_run'].includes(group.kind)) return validatePureGroup(hand, group);
  if (!maalCard) throw new Error('marriage:maal_required_for_impure');
  const family = deriveMaalFamily(maalCard);
  if (group.kind === 'impure_set') return isImpureSet(cards, family, maalAccessible);
  if (group.kind === 'impure_run') return isImpureRun(cards, family, maalAccessible);
  return false;
}

function ensureDisjointGroups(hand, groups) {
  if (!Array.isArray(groups) || groups.length === 0) throw new Error('marriage:groups_required');
  const owned = cardMap(hand);
  const used = new Set();
  for (const group of groups) {
    if (!group || typeof group !== 'object' || !Array.isArray(group.cardIds)) throw new Error('marriage:invalid_group');
    for (const id of group.cardIds) {
      if (!owned.has(id)) throw new Error('marriage:card_not_owned');
      if (used.has(id)) throw new Error('marriage:card_reused');
      used.add(id);
    }
  }
  return used;
}

export function evaluateQualification(hand, groups) {
  ensureDisjointGroups(hand, groups);
  let pure = 0;
  let dublees = 0;
  for (const group of groups) {
    const cards = resolveCards(hand, group.cardIds);
    if (group.kind === 'dublee') {
      if (!isDublee(cards)) throw new Error('marriage:invalid_dublee');
      dublees += 1;
    } else {
      if (!validatePureGroup(hand, group)) throw new Error('marriage:qualification_requires_pure');
      pure += 1;
    }
  }
  return Object.freeze({ pureMelds: pure, dublees, qualifies: pure >= MARRIAGE_RULES.pureMeldsToQualify || dublees >= MARRIAGE_RULES.dubleesToQualify });
}

export function declareQualification(state, seat, groups) {
  assertSeat(state, seat);
  const result = evaluateQualification(state.players[seat].hand, groups);
  if (!result.qualifies) throw new Error('marriage:not_qualified');
  if (state.qualifiedSeats.includes(seat)) return state;
  const next = clone(state);
  next.qualifiedSeats.push(seat);
  next.qualifiedSeats.sort((a, b) => a - b);
  next.actionNumber += 1;
  return deepFreeze(next);
}

export function revealMaal(state, seat) {
  assertSeat(state, seat);
  if (state.maalMode === 'open') return state;
  if (!state.qualifiedSeats.includes(seat)) throw new Error('marriage:maal_locked');
  if (state.maalSeenBy.includes(seat)) return state;
  const next = clone(state);
  next.maalSeenBy.push(seat);
  next.maalSeenBy.sort((a, b) => a - b);
  next.actionNumber += 1;
  return deepFreeze(next);
}

export function drawCard(state, seat, source = 'stock') {
  assertSeat(state, seat);
  if (state.winnerSeat !== null) throw new Error('marriage:round_complete');
  if (seat !== state.currentSeat || state.turnStage !== 'draw') throw new Error('marriage:not_draw_turn');
  const next = clone(state);
  let card;
  if (source === 'stock') {
    if (next.stock.length === 0) throw new Error('marriage:stock_empty');
    card = next.stock.shift();
  } else if (source === 'discard') {
    if (next.discardPile.length === 0) throw new Error('marriage:discard_empty');
    card = next.discardPile.pop();
  } else {
    throw new Error('marriage:invalid_draw_source');
  }
  next.players[seat].hand.push(card);
  next.turnStage = 'discard';
  next.actionNumber += 1;
  return deepFreeze(next);
}

export function discardCard(state, seat, cardId) {
  assertSeat(state, seat);
  if (state.winnerSeat !== null) throw new Error('marriage:round_complete');
  if (seat !== state.currentSeat || state.turnStage !== 'discard') throw new Error('marriage:not_discard_turn');
  const next = clone(state);
  const hand = next.players[seat].hand;
  const index = hand.findIndex((card) => card.id === cardId);
  if (index < 0) throw new Error('marriage:card_not_owned');
  const [card] = hand.splice(index, 1);
  if (hand.length !== MARRIAGE_RULES.cardsPerPlayer) throw new Error('marriage:hand_size_after_discard');
  next.discardPile.push(card);
  next.currentSeat = (seat - 1 + next.players.length) % next.players.length;
  next.turnStage = 'draw';
  next.actionNumber += 1;
  return deepFreeze(next);
}

function fullCoverage(hand, groups) {
  const used = ensureDisjointGroups(hand, groups);
  return used.size === hand.length;
}

export function validateFinish(state, seat, groups) {
  assertSeat(state, seat);
  const hand = state.players[seat].hand;
  if (hand.length !== MARRIAGE_RULES.cardsPerPlayer) throw new Error('marriage:finish_requires_21_cards');
  if (!fullCoverage(hand, groups)) throw new Error('marriage:finish_must_cover_hand');
  const maalAccessible = state.maalMode === 'open' || state.maalSeenBy.includes(seat);
  let pure = 0;
  let dublees = 0;
  for (const group of groups) {
    const cards = resolveCards(hand, group.cardIds);
    if (group.kind === 'dublee') {
      if (!isDublee(cards)) throw new Error('marriage:invalid_dublee');
      dublees += 1;
      continue;
    }
    if (['tunnela', 'pure_set', 'pure_run'].includes(group.kind)) {
      if (!validatePureGroup(hand, group)) throw new Error('marriage:invalid_pure_meld');
      pure += 1;
      continue;
    }
    if (!validateMeld(hand, group, { maalCard: state.maalCard, maalAccessible })) throw new Error('marriage:invalid_impure_meld');
  }
  const standardFinish = pure >= MARRIAGE_RULES.pureMeldsToQualify && groups.every((group) => group.kind !== 'dublee');
  const dubleeFinish = dublees >= MARRIAGE_RULES.dubleesToFinish;
  if (!standardFinish && !dubleeFinish) throw new Error('marriage:finish_rule_not_met');
  return Object.freeze({ standardFinish, dubleeFinish, pureMelds: pure, dublees });
}

export function declareFinish(state, seat, groups) {
  if (seat !== state.currentSeat || state.turnStage !== 'draw') throw new Error('marriage:not_finish_turn');
  const result = validateFinish(state, seat, groups);
  const next = clone(state);
  next.winnerSeat = seat;
  next.actionNumber += 1;
  return deepFreeze({ state: next, result });
}

function scoreRoleCount(count, single, pair) {
  return Math.floor(count / 2) * pair + (count % 2) * single;
}

export function scoreMarriageBonuses(hand, maalCard) {
  const family = deriveMaalFamily(maalCard);
  const counts = { jhiplu: 0, tiplu: 0, poplu: 0 };
  let printedJokers = 0;
  const exactNatural = new Map();
  for (const card of hand) {
    if (card.printedJoker) {
      printedJokers += 1;
      continue;
    }
    const role = maalRole(card, family);
    if (role) counts[role] += 1;
    const key = `${card.rank}:${card.suit}`;
    exactNatural.set(key, (exactNatural.get(key) ?? 0) + 1);
  }
  const marriages = Math.min(counts.jhiplu, counts.tiplu, counts.poplu);
  counts.jhiplu -= marriages;
  counts.tiplu -= marriages;
  counts.poplu -= marriages;
  const tunnelaCount = [...exactNatural.values()].filter((count) => count === 3).length;
  const maalPoints = marriages * MARRIAGE_RULES.scores.marriage
    + scoreRoleCount(counts.jhiplu, MARRIAGE_RULES.scores.jhipluSingle, MARRIAGE_RULES.scores.jhipluPair)
    + scoreRoleCount(counts.tiplu, MARRIAGE_RULES.scores.tipluSingle, MARRIAGE_RULES.scores.tipluPair)
    + scoreRoleCount(counts.poplu, MARRIAGE_RULES.scores.popluSingle, MARRIAGE_RULES.scores.popluPair);
  const tunnelaPoints = tunnelaCount * MARRIAGE_RULES.scores.tunnela;
  const jokerPoints = printedJokers * MARRIAGE_RULES.scores.printedJoker;
  return Object.freeze({ marriages, maalPoints, tunnelaCount, tunnelaPoints, printedJokers, jokerPoints, total: maalPoints + tunnelaPoints + jokerPoints });
}

export function projectMarriagePublic(state) {
  return deepFreeze({
    game: state.game,
    maalMode: state.maalMode,
    maalCard: state.maalMode === 'open' ? clone(state.maalCard) : null,
    currentSeat: state.currentSeat,
    turnStage: state.turnStage,
    stockCount: state.stock.length,
    topDiscard: state.discardPile.length ? clone(state.discardPile[state.discardPile.length - 1]) : null,
    players: state.players.map((player, seat) => ({ id: player.id, seat, handCount: player.hand.length, qualified: state.qualifiedSeats.includes(seat) })),
    winnerSeat: state.winnerSeat,
    actionNumber: state.actionNumber,
  });
}

export function projectMarriageSeat(state, seat) {
  assertSeat(state, seat);
  const projection = clone(projectMarriagePublic(state));
  projection.hand = clone(state.players[seat].hand);
  projection.maalCard = state.maalMode === 'open' || state.maalSeenBy.includes(seat) ? clone(state.maalCard) : null;
  projection.maalAccessible = projection.maalCard !== null;
  return deepFreeze(projection);
}
