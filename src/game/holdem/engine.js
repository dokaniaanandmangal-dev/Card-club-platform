import { buildHoldemDeck, validateHoldemDeck } from './cards.js';
import { compareHands, evaluateBest } from './evaluator.js';

export const HOLDEM_RULES = Object.freeze({
  game: 'no_limit_texas_holdem',
  minPlayers: 2,
  maxPlayers: 9,
  holeCards: 2,
  boardCards: 5,
  burnCards: 3,
  betting: 'no_limit',
  oddChip: 'first-winning-seat-clockwise-left-of-dealer',
});

const ACTIVE = new Set(['active','all_in']);

function clone(value) { return structuredClone(value); }
function assertInt(value, name, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) throw new Error(`${name} must be a safe integer >= ${min}`);
}
function orderedSeats(players) { return players.map((player) => player.seat).sort((a,b) => a-b); }
function nextSeatFromList(seats, seat, predicate = () => true) {
  const index = seats.indexOf(seat);
  if (index < 0) throw new Error('seat not at table');
  for (let offset = 1; offset <= seats.length; offset += 1) {
    const candidate = seats[(index + offset) % seats.length];
    if (predicate(candidate)) return candidate;
  }
  return null;
}
function playerBySeat(state, seat) {
  const player = state.players.find((entry) => entry.seat === seat);
  if (!player) throw new Error('unknown seat');
  return player;
}
function canAct(player) { return player.status === 'active'; }
function contenders(state) { return state.players.filter((player) => ACTIVE.has(player.status)); }
function liveActors(state) { return state.players.filter(canAct); }
function totalChips(state) {
  return state.players.reduce((sum,p) => sum + p.stack + p.totalContribution, 0);
}
function assertConservation(state) {
  if (totalChips(state) !== state.initialChipTotal) throw new Error('chip conservation failure');
}
function contributionTo(state, player, target) {
  const needed = Math.max(0, target - player.streetContribution);
  const paid = Math.min(player.stack, needed);
  player.stack -= paid;
  player.streetContribution += paid;
  player.totalContribution += paid;
  if (player.stack === 0) player.status = 'all_in';
  return paid;
}
function postForced(state, player, amount) {
  const paid = Math.min(player.stack, amount);
  player.stack -= paid;
  player.streetContribution += paid;
  player.totalContribution += paid;
  if (player.stack === 0) player.status = 'all_in';
  return paid;
}
function dealHoleCards(state) {
  const seats = orderedSeats(state.players);
  let seat = state.dealerSeat;
  for (let round = 0; round < 2; round += 1) {
    for (let count = 0; count < seats.length; count += 1) {
      seat = nextSeatFromList(seats, seat);
      playerBySeat(state, seat).hole.push(state.deck.shift());
    }
  }
}
function activeSeatOrderFrom(state, startSeat) {
  const seats = orderedSeats(state.players);
  const result = [];
  let current = startSeat;
  for (let i = 0; i < seats.length; i += 1) {
    current = nextSeatFromList(seats, current);
    result.push(current);
  }
  return result;
}
function findNextActor(state, afterSeat) {
  const seats = orderedSeats(state.players);
  return nextSeatFromList(seats, afterSeat, (seat) => canAct(playerBySeat(state, seat)));
}
function roundComplete(state) {
  const actors = liveActors(state);
  if (actors.length === 0) return true;
  return actors.every((player) => player.streetContribution === state.currentBet && player.lastActionRaiseEpoch === state.raiseEpoch);
}
function resetForStreet(state, street) {
  state.street = street;
  state.currentBet = 0;
  state.lastFullRaiseSize = state.bigBlind;
  state.raiseEpoch += 1;
  for (const player of state.players) {
    player.streetContribution = 0;
    player.lastActionRaiseEpoch = -1;
  }
  const seats = orderedSeats(state.players);
  state.currentSeat = nextSeatFromList(seats, state.dealerSeat, (seat) => canAct(playerBySeat(state, seat)));
}
function burnAndDeal(state, count) {
  if (state.deck.length < count + 1) throw new Error('deck exhausted');
  state.burn.push(state.deck.shift());
  for (let i = 0; i < count; i += 1) state.board.push(state.deck.shift());
}
function awardFoldWin(state) {
  const remaining = contenders(state);
  if (remaining.length !== 1) return false;
  const winner = remaining[0];
  const pot = state.players.reduce((sum,p) => sum + p.totalContribution, 0);
  winner.stack += pot;
  state.pots = [{ amount: pot, eligibleSeats: [winner.seat], winners: [winner.seat] }];
  state.status = 'complete';
  state.result = { reason: 'all_others_folded', winners: [winner.seat], pot };
  state.currentSeat = null;
  for (const player of state.players) player.totalContribution = 0;
  assertConservation(state);
  return true;
}

export function buildSidePots(players) {
  const levels = [...new Set(players.map((player) => player.totalContribution).filter((value) => value > 0))].sort((a,b) => a-b);
  const pots = [];
  let previous = 0;
  for (const level of levels) {
    const contributors = players.filter((player) => player.totalContribution >= level);
    const amount = (level - previous) * contributors.length;
    const eligibleSeats = contributors.filter((player) => player.status !== 'folded').map((player) => player.seat).sort((a,b) => a-b);
    if (amount > 0) pots.push({ amount, eligibleSeats });
    previous = level;
  }
  return pots;
}

function showdown(state) {
  while (state.board.length < 5) {
    if (state.board.length === 0) burnAndDeal(state, 3);
    else burnAndDeal(state, 1);
  }
  const rankings = new Map();
  for (const player of contenders(state)) rankings.set(player.seat, evaluateBest([...player.hole, ...state.board]));
  const pots = buildSidePots(state.players);
  const clockwise = activeSeatOrderFrom(state, state.dealerSeat);
  for (const pot of pots) {
    if (pot.eligibleSeats.length === 0) throw new Error('pot has no eligible winner');
    let winners = [];
    let best = null;
    for (const seat of pot.eligibleSeats) {
      const ranking = rankings.get(seat);
      if (!best || compareHands(ranking, best) > 0) { best = ranking; winners = [seat]; }
      else if (compareHands(ranking, best) === 0) winners.push(seat);
    }
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount % winners.length;
    for (const seat of winners) playerBySeat(state, seat).stack += share;
    for (const seat of clockwise) {
      if (remainder === 0) break;
      if (winners.includes(seat)) { playerBySeat(state, seat).stack += 1; remainder -= 1; }
    }
    pot.winners = [...winners].sort((a,b) => a-b);
    pot.ranking = { category: best.category, tuple: [...best.tuple] };
  }
  state.pots = pots;
  state.status = 'complete';
  state.currentSeat = null;
  state.result = { reason: 'showdown', winners: [...new Set(pots.flatMap((pot) => pot.winners))].sort((a,b) => a-b) };
  for (const player of state.players) player.totalContribution = 0;
  state.showdownSeats = contenders(state).map((player) => player.seat).sort((a,b) => a-b);
  assertConservation(state);
}

function advance(state) {
  if (awardFoldWin(state)) return state;
  if (!roundComplete(state)) return state;
  if (state.street === 'river') { showdown(state); return state; }
  if (state.street === 'preflop') { burnAndDeal(state, 3); resetForStreet(state, 'flop'); }
  else if (state.street === 'flop') { burnAndDeal(state, 1); resetForStreet(state, 'turn'); }
  else if (state.street === 'turn') { burnAndDeal(state, 1); resetForStreet(state, 'river'); }
  if (liveActors(state).length <= 1) {
    for (const player of liveActors(state)) player.lastActionRaiseEpoch = state.raiseEpoch;
    if (roundComplete(state)) return advance(state);
  }
  return state;
}

export function createHoldemHand({ players, dealerSeat, smallBlind, bigBlind, deck = buildHoldemDeck() }) {
  if (!Array.isArray(players) || players.length < HOLDEM_RULES.minPlayers || players.length > HOLDEM_RULES.maxPlayers) throw new Error('holdem requires 2-9 players');
  assertInt(dealerSeat, 'dealerSeat'); assertInt(smallBlind, 'smallBlind', 1); assertInt(bigBlind, 'bigBlind', 1);
  if (bigBlind <= smallBlind) throw new Error('big blind must exceed small blind');
  const seatSet = new Set(); const idSet = new Set();
  const normalized = players.map((player) => {
    if (!player || typeof player.id !== 'string' || player.id.length === 0) throw new Error('player id required');
    assertInt(player.seat, 'seat'); assertInt(player.stack, 'stack', bigBlind);
    if (seatSet.has(player.seat) || idSet.has(player.id)) throw new Error('duplicate player identity');
    seatSet.add(player.seat); idSet.add(player.id);
    return { id: player.id, seat: player.seat, stack: player.stack, status:'active', hole:[], streetContribution:0, totalContribution:0, lastActionRaiseEpoch:-1 };
  }).sort((a,b) => a.seat-b.seat);
  if (!seatSet.has(dealerSeat)) throw new Error('dealer must be seated');
  validateHoldemDeck(deck);
  const state = {
    game: HOLDEM_RULES.game, status:'betting', street:'preflop', dealerSeat, smallBlind, bigBlind,
    players: normalized, deck: deck.map((card) => ({...card})), board:[], burn:[], pots:[], result:null, showdownSeats:[],
    currentBet:bigBlind, lastFullRaiseSize:bigBlind, raiseEpoch:0, currentSeat:null,
    initialChipTotal: normalized.reduce((sum,p) => sum+p.stack,0),
  };
  dealHoleCards(state);
  const seats = orderedSeats(state.players);
  let sbSeat, bbSeat;
  if (normalized.length === 2) { sbSeat = dealerSeat; bbSeat = nextSeatFromList(seats, dealerSeat); }
  else { sbSeat = nextSeatFromList(seats, dealerSeat); bbSeat = nextSeatFromList(seats, sbSeat); }
  state.smallBlindSeat = sbSeat; state.bigBlindSeat = bbSeat;
  postForced(state, playerBySeat(state, sbSeat), smallBlind);
  postForced(state, playerBySeat(state, bbSeat), bigBlind);
  state.currentBet = Math.max(...state.players.map((player) => player.streetContribution));
  state.currentSeat = normalized.length === 2 ? sbSeat : findNextActor(state, bbSeat);
  assertConservation(state);
  return state;
}

export function actHoldem(stateInput, seat, action) {
  const state = clone(stateInput);
  if (state.status !== 'betting') throw new Error('hand is not accepting actions');
  if (state.currentSeat !== seat) throw new Error('out of turn');
  const player = playerBySeat(state, seat);
  if (!canAct(player)) throw new Error('seat cannot act');
  if (!action || typeof action.type !== 'string') throw new Error('action type required');
  const toCall = Math.max(0, state.currentBet - player.streetContribution);
  const markActed = () => { player.lastActionRaiseEpoch = state.raiseEpoch; };

  if (action.type === 'fold') { player.status = 'folded'; markActed(); }
  else if (action.type === 'check') {
    if (toCall !== 0) throw new Error('cannot check facing a bet'); markActed();
  } else if (action.type === 'call') {
    if (toCall === 0) throw new Error('nothing to call'); contributionTo(state, player, state.currentBet); markActed();
  } else if (action.type === 'bet' || action.type === 'raise') {
    assertInt(action.to, 'raise target', 1);
    if (player.lastActionRaiseEpoch === state.raiseEpoch) throw new Error('betting not reopened for this seat');
    if (state.currentBet === 0 && action.type !== 'bet') throw new Error('use bet when no bet exists');
    if (state.currentBet > 0 && action.type !== 'raise') throw new Error('use raise when a bet exists');
    if (action.to <= state.currentBet) throw new Error('target must exceed current bet');
    const maxTo = player.streetContribution + player.stack;
    if (action.to > maxTo) throw new Error('target exceeds stack');
    const raiseSize = action.to - state.currentBet;
    const isAllIn = action.to === maxTo;
    if (raiseSize < state.lastFullRaiseSize && !isAllIn) throw new Error('raise below minimum');
    contributionTo(state, player, action.to);
    state.currentBet = action.to;
    if (raiseSize >= state.lastFullRaiseSize) {
      state.lastFullRaiseSize = raiseSize;
      state.raiseEpoch += 1;
      player.lastActionRaiseEpoch = state.raiseEpoch;
    } else markActed();
  } else if (action.type === 'all_in') {
    const target = player.streetContribution + player.stack;
    if (target <= state.currentBet) { contributionTo(state, player, target); markActed(); }
    else {
      const raiseSize = target - state.currentBet;
      contributionTo(state, player, target);
      state.currentBet = target;
      if (raiseSize >= state.lastFullRaiseSize) {
        state.lastFullRaiseSize = raiseSize;
        state.raiseEpoch += 1;
        player.lastActionRaiseEpoch = state.raiseEpoch;
      } else markActed();
    }
  } else throw new Error('unsupported holdem action');

  if (awardFoldWin(state)) return state;
  if (!roundComplete(state)) state.currentSeat = findNextActor(state, seat);
  return advance(state);
}

export function projectHoldemPublic(state) {
  const showdown = state.status === 'complete' && state.result?.reason === 'showdown';
  return {
    game: state.game, status: state.status, street: state.street, dealerSeat: state.dealerSeat,
    smallBlindSeat: state.smallBlindSeat, bigBlindSeat: state.bigBlindSeat, currentSeat: state.currentSeat,
    currentBet: state.currentBet, board: state.board.map((card) => ({...card})),
    players: state.players.map((player) => ({ id:player.id, seat:player.seat, stack:player.stack, status:player.status,
      streetContribution:player.streetContribution, totalContribution:player.totalContribution,
      hole: showdown && state.showdownSeats.includes(player.seat) ? player.hole.map((card)=>({...card})) : null })),
    pots: clone(state.pots), result: clone(state.result),
  };
}

export function projectHoldemSeat(state, seat) {
  playerBySeat(state, seat);
  const view = projectHoldemPublic(state);
  const own = state.players.find((player) => player.seat === seat);
  view.players.find((player) => player.seat === seat).hole = own.hole.map((card) => ({...card}));
  return view;
}
