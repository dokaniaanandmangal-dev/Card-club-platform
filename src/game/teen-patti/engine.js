import { validateTeenPattiDeck } from './cards.js';
import { compareTeenPattiHands, evaluateTeenPattiHand } from './evaluator.js';

export const TEEN_PATTI_RULES = Object.freeze({
  variant: 'classic',
  minPlayers: 2,
  maxPlayers: 10,
  cardsPerPlayer: 3,
  blindMinMultiplier: 1,
  blindMaxMultiplier: 2,
  seenMinMultiplier: 2,
  seenMaxMultiplier: 4,
  sideshowMinActivePlayers: 3,
  tieOnSideshow: 'requester_packs',
  tieOnShowdown: 'requester_loses',
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function copy(state) {
  return structuredClone(state);
}

function assertPositiveInt(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
}

function activeSeats(state) {
  return state.players.map((player, seat) => player.status === 'active' ? seat : -1).filter((seat) => seat >= 0);
}

function nextActiveSeat(state, fromSeat) {
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const seat = (fromSeat + offset) % state.players.length;
    if (state.players[seat].status === 'active') return seat;
  }
  return null;
}

function previousActiveSeat(state, fromSeat) {
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const seat = (fromSeat - offset + state.players.length) % state.players.length;
    if (state.players[seat].status === 'active') return seat;
  }
  return null;
}

function assertBetting(state) {
  if (!state || state.game !== 'teen_patti_classic' || state.phase !== 'betting') throw new Error('teen patti round is not betting');
}

function assertTurn(state, seat) {
  assertBetting(state);
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.players.length) throw new Error('invalid teen patti seat');
  if (state.currentSeat !== seat) throw new Error('out-of-turn teen patti action');
  if (state.players[seat].status !== 'active') throw new Error('packed player cannot act');
  if (state.pendingSideshow) throw new Error('sideshow response is pending');
}

function pay(next, seat, amount) {
  assertPositiveInt(amount, 'teen patti amount');
  const player = next.players[seat];
  if (player.stack < amount) throw new Error('insufficient teen patti stack');
  player.stack -= amount;
  player.contribution += amount;
  next.pot += amount;
}

function assertConservation(state) {
  const total = state.pot + state.players.reduce((sum, player) => sum + player.stack, 0);
  if (total !== state.initialTotal) throw new Error('teen patti chip conservation failure');
}

function awardPot(next, winnerSeat, reason, revealedSeats = []) {
  const amount = next.pot;
  next.players[winnerSeat].stack += amount;
  next.pot = 0;
  next.phase = 'completed';
  next.currentSeat = null;
  next.pendingSideshow = null;
  const revealedHands = {};
  for (const seat of revealedSeats) {
    revealedHands[next.players[seat].id] = next.players[seat].hand.map((card) => ({ ...card }));
  }
  next.result = {
    winnerSeat,
    winnerId: next.players[winnerSeat].id,
    amount,
    reason,
    revealedHands,
  };
  assertConservation(next);
  return deepFreeze(next);
}

export function createTeenPattiRound({ players, deck, boot, dealerSeat = 0 }) {
  if (!Array.isArray(players) || players.length < TEEN_PATTI_RULES.minPlayers || players.length > TEEN_PATTI_RULES.maxPlayers) {
    throw new Error('teen patti requires 2-10 players');
  }
  assertPositiveInt(boot, 'teen patti boot');
  if (!Number.isInteger(dealerSeat) || dealerSeat < 0 || dealerSeat >= players.length) throw new Error('invalid teen patti dealer seat');
  validateTeenPattiDeck(deck);
  const ids = new Set();
  const normalizedPlayers = players.map((player) => {
    if (!player || typeof player.id !== 'string' || player.id.length < 1 || ids.has(player.id)) throw new Error('invalid or duplicate teen patti player');
    ids.add(player.id);
    assertPositiveInt(player.stack, 'teen patti player stack');
    if (player.stack < boot) throw new Error('teen patti stack below boot');
    return { id: player.id, startingStack: player.stack, stack: player.stack - boot, status: 'active', seen: false, hand: [], contribution: boot };
  });
  const stock = deck.map((card) => ({ ...card }));
  const firstSeat = (dealerSeat + 1) % normalizedPlayers.length;
  for (let round = 0; round < 3; round += 1) {
    for (let offset = 0; offset < normalizedPlayers.length; offset += 1) {
      const seat = (firstSeat + offset) % normalizedPlayers.length;
      normalizedPlayers[seat].hand.push(stock.shift());
    }
  }
  const initialTotal = normalizedPlayers.reduce((sum, player) => sum + player.startingStack, 0);
  const state = {
    game: 'teen_patti_classic',
    phase: 'betting',
    dealerSeat,
    currentSeat: firstSeat,
    boot,
    unitStake: boot,
    pot: boot * normalizedPlayers.length,
    initialTotal,
    actionNo: 0,
    players: normalizedPlayers,
    stock,
    pendingSideshow: null,
    result: null,
  };
  assertConservation(state);
  return deepFreeze(state);
}

export function seeCards(state, seat) {
  assertTurn(state, seat);
  const next = copy(state);
  if (next.players[seat].seen) return deepFreeze(next);
  next.players[seat].seen = true;
  next.actionNo += 1;
  return deepFreeze(next);
}

export function legalChaalRange(state, seat) {
  assertBetting(state);
  const player = state.players[seat];
  if (!player || player.status !== 'active') throw new Error('inactive teen patti seat');
  const seen = player.seen;
  return Object.freeze({
    min: state.unitStake * (seen ? TEEN_PATTI_RULES.seenMinMultiplier : TEEN_PATTI_RULES.blindMinMultiplier),
    max: state.unitStake * (seen ? TEEN_PATTI_RULES.seenMaxMultiplier : TEEN_PATTI_RULES.blindMaxMultiplier),
  });
}

export function chaal(state, seat, amount) {
  assertTurn(state, seat);
  const { min, max } = legalChaalRange(state, seat);
  if (!Number.isSafeInteger(amount) || amount < min || amount > max) throw new Error(`illegal teen patti chaal; expected ${min}-${max}`);
  const next = copy(state);
  const wasSeen = next.players[seat].seen;
  pay(next, seat, amount);
  const normalizedStake = wasSeen ? Math.ceil(amount / 2) : amount;
  next.unitStake = Math.max(next.unitStake, normalizedStake);
  next.actionNo += 1;
  next.currentSeat = nextActiveSeat(next, seat);
  assertConservation(next);
  return deepFreeze(next);
}

export function pack(state, seat) {
  assertTurn(state, seat);
  const next = copy(state);
  next.players[seat].status = 'packed';
  next.actionNo += 1;
  const active = activeSeats(next);
  if (active.length === 1) return awardPot(next, active[0], 'last_player');
  next.currentSeat = nextActiveSeat(next, seat);
  assertConservation(next);
  return deepFreeze(next);
}

export function requestSideshow(state, seat) {
  assertTurn(state, seat);
  if (!state.players[seat].seen) throw new Error('blind player cannot request sideshow');
  if (activeSeats(state).length < TEEN_PATTI_RULES.sideshowMinActivePlayers) throw new Error('sideshow requires at least three active players');
  const targetSeat = previousActiveSeat(state, seat);
  if (targetSeat === null || !state.players[targetSeat].seen) throw new Error('previous active player must be seen for sideshow');
  const next = copy(state);
  const cost = next.unitStake * TEEN_PATTI_RULES.seenMinMultiplier;
  pay(next, seat, cost);
  next.pendingSideshow = { requesterSeat: seat, targetSeat, cost };
  next.actionNo += 1;
  assertConservation(next);
  return deepFreeze(next);
}

export function respondSideshow(state, targetSeat, accept) {
  assertBetting(state);
  if (!state.pendingSideshow) throw new Error('no teen patti sideshow pending');
  if (state.pendingSideshow.targetSeat !== targetSeat) throw new Error('only sideshow target may respond');
  if (typeof accept !== 'boolean') throw new Error('sideshow response must be boolean');
  const next = copy(state);
  const { requesterSeat } = next.pendingSideshow;
  next.pendingSideshow = null;
  next.actionNo += 1;
  if (accept) {
    const comparison = compareTeenPattiHands(next.players[requesterSeat].hand, next.players[targetSeat].hand);
    const loserSeat = comparison > 0 ? targetSeat : requesterSeat; // requester packs on tie
    next.players[loserSeat].status = 'packed';
    const active = activeSeats(next);
    if (active.length === 1) return awardPot(next, active[0], 'sideshow');
  }
  next.currentSeat = nextActiveSeat(next, requesterSeat);
  assertConservation(next);
  return deepFreeze(next);
}

export function showdown(state, seat) {
  assertTurn(state, seat);
  const active = activeSeats(state);
  if (active.length !== 2) throw new Error('teen patti showdown requires exactly two active players');
  if (!state.players[seat].seen) throw new Error('showdown requester must be seen');
  const opponentSeat = active.find((candidate) => candidate !== seat);
  const next = copy(state);
  const cost = next.unitStake * TEEN_PATTI_RULES.seenMinMultiplier;
  pay(next, seat, cost);
  const comparison = compareTeenPattiHands(next.players[seat].hand, next.players[opponentSeat].hand);
  const winnerSeat = comparison > 0 ? seat : opponentSeat; // requester loses ties
  next.actionNo += 1;
  return awardPot(next, winnerSeat, 'showdown', [seat, opponentSeat]);
}

export function projectTeenPattiPublic(state) {
  const revealed = state.result?.revealedHands ?? {};
  return deepFreeze({
    game: state.game,
    phase: state.phase,
    dealerSeat: state.dealerSeat,
    currentSeat: state.currentSeat,
    boot: state.boot,
    unitStake: state.unitStake,
    pot: state.pot,
    actionNo: state.actionNo,
    pendingSideshow: state.pendingSideshow ? { requesterSeat: state.pendingSideshow.requesterSeat, targetSeat: state.pendingSideshow.targetSeat } : null,
    players: state.players.map((player) => ({
      id: player.id,
      stack: player.stack,
      status: player.status,
      seen: player.seen,
      contribution: player.contribution,
      cardCount: player.hand.length,
      cards: revealed[player.id] ? revealed[player.id].map((card) => ({ ...card })) : null,
    })),
    result: state.result ? { winnerSeat: state.result.winnerSeat, winnerId: state.result.winnerId, amount: state.result.amount, reason: state.result.reason } : null,
  });
}

export function projectTeenPattiSeat(state, seat) {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.players.length) throw new Error('invalid teen patti viewer seat');
  const projection = structuredClone(projectTeenPattiPublic(state));
  projection.players[seat].cards = state.players[seat].hand.map((card) => ({ ...card }));
  return deepFreeze(projection);
}

export function buildTeenPattiSettlement(state) {
  if (!state || state.game !== 'teen_patti_classic' || state.phase !== 'completed') throw new Error('teen patti settlement requires completed round');
  const entries = state.players.map((player) => ({ playerId: player.id, delta: player.stack - player.startingStack }));
  const sum = entries.reduce((total, entry) => total + entry.delta, 0);
  if (sum !== 0) throw new Error('teen patti settlement is not conserved');
  return deepFreeze({ game: state.game, reason: state.result.reason, winnerId: state.result.winnerId, entries });
}

export function describeTeenPattiHand(state, seat) {
  if (!state?.players?.[seat]) throw new Error('invalid teen patti seat');
  return evaluateTeenPattiHand(state.players[seat].hand);
}
