import { SUITS, makeDeck, parseCard, cardBeats } from './cards.js';
import { getTrickRule } from './rules.js';

function cloneCaptured(captured, players) {
  return Object.fromEntries(players.map(id => [id, [...captured[id]]]));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function validatePlayers(players) {
  if (!Array.isArray(players) || players.length !== 4) throw new Error('trick:four_players_required');
  if (new Set(players).size !== players.length) throw new Error('trick:duplicate_player');
  for (const id of players) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id)) {
      throw new Error('trick:invalid_player');
    }
  }
}

function validateHands(players, hands, rule) {
  if (!Array.isArray(hands) || hands.length !== players.length) throw new Error('trick:invalid_hands');
  const expected = makeDeck(rule.ranks);
  const expectedHandSize = expected.length / players.length;
  const cards = [];
  for (const hand of hands) {
    if (!Array.isArray(hand) || hand.length !== expectedHandSize) throw new Error('trick:invalid_hand_size');
    for (const card of hand) {
      parseCard(card, rule.ranks);
      cards.push(card);
    }
  }
  if (new Set(cards).size !== cards.length) throw new Error('trick:duplicate_card');
  const actual = [...cards].sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((card, index) => card !== canonical[index])) {
    throw new Error('trick:deck_mismatch');
  }
}

function nextIndex(index, direction, count) {
  return direction === 'clockwise'
    ? (index + 1) % count
    : (index - 1 + count) % count;
}

function teamOf(state, playerId) {
  return state.players.indexOf(playerId) % 2;
}

function hasSuit(hand, suit, ranks) {
  return hand.some(card => parseCard(card, ranks).suit === suit);
}

function onlySuit(hand, suit, ranks) {
  return hand.length > 0 && hand.every(card => parseCard(card, ranks).suit === suit);
}

function leadRestrictionBroken(state, suit) {
  return state.brokenSuits.includes(suit);
}

function withBrokenSuit(state, suit) {
  return state.brokenSuits.includes(suit) ? state.brokenSuits : [...state.brokenSuits, suit].sort();
}

function winnerOfTrick(state, trick) {
  const rule = getTrickRule(state.gameId);
  const leadSuit = parseCard(trick[0].card, rule.ranks).suit;
  const trumpActive = Boolean(state.trumpSuit && state.trumpRevealed);
  let best = trick[0];
  for (let i = 1; i < trick.length; i += 1) {
    if (cardBeats(trick[i].card, best.card, {
      leadSuit,
      trumpSuit: state.trumpSuit,
      trumpActive,
      ranks: rule.ranks,
    })) best = trick[i];
  }
  return best.playerId;
}

export function createTrickPlayState({
  gameId,
  players,
  hands,
  leaderIndex = 0,
  trumpSuit = null,
  options = {},
}) {
  const rule = getTrickRule(gameId);
  validatePlayers(players);
  validateHands(players, hands, rule);
  if (!Number.isInteger(leaderIndex) || leaderIndex < 0 || leaderIndex >= players.length) {
    throw new Error('trick:invalid_leader');
  }

  const resolvedTrump = rule.fixedTrump ?? trumpSuit;
  if (resolvedTrump !== null && !SUITS.includes(resolvedTrump)) throw new Error('trick:invalid_trump');
  if (rule.requiresTrump && !resolvedTrump) throw new Error('trick:trump_required');
  if (!rule.fixedTrump && !rule.requiresTrump && resolvedTrump) throw new Error('trick:unexpected_trump');

  const reveal = rule.fixedTrump
    ? true
    : rule.hiddenTrumpUntilVoidRequest
      ? false
      : Boolean(resolvedTrump);

  const byPlayer = Object.fromEntries(players.map((id, index) => [id, [...hands[index]]]));
  const captured = Object.fromEntries(players.map(id => [id, []]));

  return deepFreeze({
    version: 1,
    gameId,
    players: [...players],
    hands: byPlayer,
    leaderIndex,
    currentPlayerIndex: leaderIndex,
    trumpSuit: resolvedTrump,
    trumpRevealed: reveal,
    brokenSuits: [],
    trick: [],
    completedTricks: [],
    captured,
    centerPile: [],
    consecutiveWinner: null,
    options: { lastTrickPoint: Boolean(options.lastTrickPoint) },
    finished: false,
  });
}

export function getLegalCards(state, playerId) {
  if (state.finished) return Object.freeze([]);
  const rule = getTrickRule(state.gameId);
  if (state.players[state.currentPlayerIndex] !== playerId) return Object.freeze([]);
  const hand = state.hands[playerId];
  if (state.trick.length > 0) {
    const leadSuit = parseCard(state.trick[0].card, rule.ranks).suit;
    const following = hand.filter(card => parseCard(card, rule.ranks).suit === leadSuit);
    if (following.length > 0) return Object.freeze([...following]);
    if (rule.hiddenTrumpUntilVoidRequest && !state.trumpRevealed) return Object.freeze([]);
    return Object.freeze([...hand]);
  }

  if (rule.firstLeadCard && state.completedTricks.length === 0) {
    return Object.freeze(hand.includes(rule.firstLeadCard) ? [rule.firstLeadCard] : []);
  }
  if (rule.leadRestrictionSuit && !leadRestrictionBroken(state, rule.leadRestrictionSuit)) {
    const alternatives = hand.filter(card => parseCard(card, rule.ranks).suit !== rule.leadRestrictionSuit);
    if (alternatives.length > 0) return Object.freeze(alternatives);
  }
  return Object.freeze([...hand]);
}

export function requestTrumpReveal(state, { playerId }) {
  const rule = getTrickRule(state.gameId);
  if (!rule.hiddenTrumpUntilVoidRequest) throw new Error('trick:trump_not_hidden');
  if (state.finished) throw new Error('trick:finished');
  if (state.trumpRevealed) throw new Error('trick:trump_already_revealed');
  if (state.players[state.currentPlayerIndex] !== playerId) throw new Error('trick:out_of_turn');
  if (state.trick.length === 0) throw new Error('trick:reveal_requires_led_suit');
  const leadSuit = parseCard(state.trick[0].card, rule.ranks).suit;
  if (hasSuit(state.hands[playerId], leadSuit, rule.ranks)) throw new Error('trick:must_follow_suit');
  return deepFreeze({ ...state, trumpRevealed: true });
}

export function playCard(state, { playerId, card }) {
  if (state.finished) throw new Error('trick:finished');
  const rule = getTrickRule(state.gameId);
  if (state.players[state.currentPlayerIndex] !== playerId) throw new Error('trick:out_of_turn');
  parseCard(card, rule.ranks);
  if (!state.hands[playerId].includes(card)) throw new Error('trick:card_not_owned');

  const legal = getLegalCards(state, playerId);
  if (!legal.includes(card)) {
    if (state.trick.length > 0) {
      const leadSuit = parseCard(state.trick[0].card, rule.ranks).suit;
      if (hasSuit(state.hands[playerId], leadSuit, rule.ranks)) throw new Error('trick:must_follow_suit');
      if (rule.hiddenTrumpUntilVoidRequest && !state.trumpRevealed) throw new Error('trick:reveal_trump_required');
    }
    throw new Error('trick:illegal_lead');
  }

  const hands = Object.fromEntries(state.players.map(id => [id, [...state.hands[id]]]));
  hands[playerId].splice(hands[playerId].indexOf(card), 1);
  const trick = [...state.trick, { playerId, card }];
  let brokenSuits = [...state.brokenSuits];
  const playedSuit = parseCard(card, rule.ranks).suit;
  if (rule.leadRestrictionSuit && playedSuit === rule.leadRestrictionSuit) {
    if (state.trick.length > 0) {
      const leadSuit = parseCard(state.trick[0].card, rule.ranks).suit;
      if (leadSuit !== playedSuit) brokenSuits = withBrokenSuit(state, playedSuit);
    } else if (onlySuit(state.hands[playerId], playedSuit, rule.ranks)) {
      brokenSuits = withBrokenSuit(state, playedSuit);
    }
  }

  if (trick.length < state.players.length) {
    return deepFreeze({
      ...state,
      hands,
      trick,
      brokenSuits,
      currentPlayerIndex: nextIndex(state.currentPlayerIndex, rule.direction, state.players.length),
    });
  }

  const winnerId = winnerOfTrick(state, trick);
  const winnerIndex = state.players.indexOf(winnerId);
  const completedTricks = [...state.completedTricks, { cards: trick, winnerId }];
  const captured = cloneCaptured(state.captured, state.players);
  let centerPile = [...state.centerPile];
  let consecutiveWinner = state.consecutiveWinner;
  const allHandsEmpty = state.players.every(id => hands[id].length === 0);

  if (rule.captureMode === 'consecutive-winner-pile') {
    centerPile.push(...trick.map(play => play.card));
    if (allHandsEmpty || consecutiveWinner === winnerId) {
      captured[winnerId].push(...centerPile);
      centerPile = [];
      consecutiveWinner = null;
    } else {
      consecutiveWinner = winnerId;
    }
  } else {
    captured[winnerId].push(...trick.map(play => play.card));
  }

  return deepFreeze({
    ...state,
    hands,
    trick: [],
    completedTricks,
    captured,
    centerPile,
    consecutiveWinner,
    brokenSuits,
    leaderIndex: winnerIndex,
    currentPlayerIndex: winnerIndex,
    finished: allHandsEmpty,
  });
}

export function projectTrickState(state, viewerId = null) {
  if (viewerId !== null && !state.players.includes(viewerId)) throw new Error('trick:unknown_viewer');
  const seats = state.players.map((playerId, index) => {
    const seat = {
      playerId,
      index,
      handCount: state.hands[playerId].length,
      capturedCount: state.captured[playerId].length,
    };
    if (playerId === viewerId) seat.hand = [...state.hands[playerId]];
    return seat;
  });
  return deepFreeze({
    version: state.version,
    gameId: state.gameId,
    seats,
    leaderIndex: state.leaderIndex,
    currentPlayerIndex: state.currentPlayerIndex,
    trick: state.trick.map(play => ({ ...play })),
    completedTrickCount: state.completedTricks.length,
    trumpRevealed: state.trumpRevealed,
    trumpSuit: state.trumpRevealed ? state.trumpSuit : null,
    brokenSuits: [...state.brokenSuits],
    centerPileCount: state.centerPile.length,
    finished: state.finished,
  });
}

export function summarizeTrickHand(state) {
  if (!state.finished) throw new Error('trick:not_finished');
  const rule = getTrickRule(state.gameId);
  const trickCounts = [0, 0];
  for (const trick of state.completedTricks) trickCounts[teamOf(state, trick.winnerId)] += 1;

  if (state.gameId === 'spades') return deepFreeze({ gameId: state.gameId, teamTricks: trickCounts });

  if (state.gameId === 'hearts') {
    const penalties = Object.fromEntries(state.players.map(id => [id, 0]));
    for (const id of state.players) {
      for (const card of state.captured[id]) {
        const parsed = parseCard(card, rule.ranks);
        if (parsed.suit === 'H') penalties[id] += 1;
        if (card === 'QS') penalties[id] += 13;
      }
    }
    const shooter = state.players.find(id => penalties[id] === 26) ?? null;
    const adjusted = { ...penalties };
    if (shooter) {
      for (const id of state.players) adjusted[id] = id === shooter ? 0 : 26;
    }
    return deepFreeze({ gameId: state.gameId, penalties, adjustedPenalties: adjusted, shooter });
  }

  if (state.gameId === '29') {
    const values = { J: 3, '9': 2, A: 1, '10': 1, K: 0, Q: 0, '8': 0, '7': 0 };
    const teamPoints = [0, 0];
    for (const id of state.players) {
      for (const card of state.captured[id]) teamPoints[teamOf(state, id)] += values[parseCard(card, rule.ranks).rank];
    }
    if (state.options.lastTrickPoint) {
      const winner = state.completedTricks.at(-1).winnerId;
      teamPoints[teamOf(state, winner)] += 1;
    }
    return deepFreeze({ gameId: state.gameId, teamPoints, lastTrickPoint: state.options.lastTrickPoint });
  }

  if (state.gameId === 'court-piece') {
    return deepFreeze({
      gameId: state.gameId,
      teamTricks: trickCounts,
      handWinner: trickCounts[0] > trickCounts[1] ? 0 : 1,
      court: trickCounts[0] === 13 ? 0 : trickCounts[1] === 13 ? 1 : null,
    });
  }

  if (state.gameId === 'dehla-pakad') {
    const tens = [0, 0];
    for (const id of state.players) {
      for (const card of state.captured[id]) if (parseCard(card, rule.ranks).rank === '10') tens[teamOf(state, id)] += 1;
    }
    return deepFreeze({
      gameId: state.gameId,
      tens,
      handWinner: tens[0] > 2 ? 0 : tens[1] > 2 ? 1 : null,
      kot: tens[0] === 4 ? 0 : tens[1] === 4 ? 1 : null,
    });
  }

  throw new Error('trick:unsupported_summary');
}
