import { SUITS, STANDARD_RANKS, makeDeck, parseCard } from './cards.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function validatePlayers(players) {
  if (!Array.isArray(players) || players.length !== 4 || new Set(players).size !== 4) {
    throw new Error('trump_setup:four_unique_players_required');
  }
}

function validateHands(players, hands, size, field) {
  if (!Array.isArray(hands) || hands.length !== 4 || !hands.every(hand => Array.isArray(hand) && hand.length === size)) {
    throw new Error(`trump_setup:${field}_invalid_hands`);
  }
  const allowed = new Set(makeDeck(STANDARD_RANKS));
  const all = hands.flat();
  for (const card of all) {
    parseCard(card, STANDARD_RANKS);
    if (!allowed.has(card)) throw new Error('trump_setup:invalid_card');
  }
  if (new Set(all).size !== all.length) throw new Error('trump_setup:duplicate_card');
}

export function createFiveCardTrumpSetup({ gameId, players, firstFiveHands, dealerIndex }) {
  if (gameId !== 'court-piece' && gameId !== 'dehla-pakad') throw new Error('trump_setup:unsupported_game');
  validatePlayers(players);
  validateHands(players, firstFiveHands, 5, 'first_five');
  if (!Number.isInteger(dealerIndex) || dealerIndex < 0 || dealerIndex > 3) throw new Error('trump_setup:invalid_dealer');
  const callerIndex = (dealerIndex - 1 + 4) % 4;
  return deepFreeze({
    gameId,
    players: [...players],
    dealerIndex,
    callerIndex,
    firstFiveHands: Object.fromEntries(players.map((id, i) => [id, [...firstFiveHands[i]]])),
    trumpSuit: null,
    phase: 'trump-selection',
  });
}

export function chooseFiveCardTrump(state, { playerId, trumpSuit }) {
  if (state.phase !== 'trump-selection') throw new Error('trump_setup:trump_already_selected');
  if (state.players[state.callerIndex] !== playerId) throw new Error('trump_setup:only_caller_selects_trump');
  if (!SUITS.includes(trumpSuit)) throw new Error('trump_setup:invalid_trump');
  return deepFreeze({ ...state, trumpSuit, phase: 'awaiting-remainder' });
}

export function completeFiveCardTrumpDeal(state, { remainingHands }) {
  if (state.phase !== 'awaiting-remainder' || !state.trumpSuit) throw new Error('trump_setup:trump_required');
  validateHands(state.players, remainingHands, 8, 'remaining');
  const hands = state.players.map((id, i) => [...state.firstFiveHands[id], ...remainingHands[i]]);
  const actual = hands.flat().sort();
  const expected = [...makeDeck(STANDARD_RANKS)].sort();
  if (actual.length !== expected.length || actual.some((card, i) => card !== expected[i])) {
    throw new Error('trump_setup:deck_mismatch');
  }
  return deepFreeze({
    gameId: state.gameId,
    players: [...state.players],
    hands,
    dealerIndex: state.dealerIndex,
    callerIndex: state.callerIndex,
    leaderIndex: state.callerIndex,
    trumpSuit: state.trumpSuit,
  });
}

export function projectFiveCardTrumpSetup(state, viewerId = null) {
  if (viewerId !== null && !state.players.includes(viewerId)) throw new Error('trump_setup:unknown_viewer');
  return deepFreeze({
    gameId: state.gameId,
    dealerIndex: state.dealerIndex,
    callerIndex: state.callerIndex,
    phase: state.phase,
    trumpSuit: state.trumpSuit,
    seats: state.players.map((playerId, index) => ({
      playerId,
      index,
      handCount: 5,
      ...(playerId === viewerId ? { hand: [...state.firstFiveHands[playerId]] } : {}),
    })),
  });
}
