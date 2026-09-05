import { SUITS, TWENTY_NINE_RANKS, makeDeck, parseCard } from './cards.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function validatePlayers(players) {
  if (!Array.isArray(players) || players.length !== 4 || new Set(players).size !== 4) {
    throw new Error('29:four_unique_players_required');
  }
}

function validatePartialHands(players, hands, size) {
  if (!Array.isArray(hands) || hands.length !== 4 || !hands.every(hand => Array.isArray(hand) && hand.length === size)) {
    throw new Error('29:invalid_partial_hands');
  }
  const allowed = new Set(makeDeck(TWENTY_NINE_RANKS));
  const all = hands.flat();
  for (const card of all) {
    parseCard(card, TWENTY_NINE_RANKS);
    if (!allowed.has(card)) throw new Error('29:invalid_card');
  }
  if (new Set(all).size !== all.length) throw new Error('29:duplicate_card');
}

export function createTwentyNineAuction({ players, firstFourHands, dealerIndex, minBid = 15, maxBid = 28 }) {
  validatePlayers(players);
  validatePartialHands(players, firstFourHands, 4);
  if (!Number.isInteger(dealerIndex) || dealerIndex < 0 || dealerIndex > 3) throw new Error('29:invalid_dealer');
  if (!Number.isInteger(minBid) || !Number.isInteger(maxBid) || minBid < 1 || maxBid > 28 || minBid >= maxBid) {
    throw new Error('29:invalid_bid_range');
  }
  return deepFreeze({
    players: [...players],
    firstFourHands: Object.fromEntries(players.map((id, i) => [id, [...firstFourHands[i]]])),
    dealerIndex,
    minBid,
    maxBid,
    nextBidderIndex: (dealerIndex + 1) % 4,
    highBid: null,
    highBidder: null,
    consecutivePasses: 0,
    calls: [],
    phase: 'auction',
    trumpSuit: null,
  });
}

export function submitTwentyNineCall(state, { playerId, call }) {
  if (state.phase !== 'auction') throw new Error('29:auction_complete');
  if (state.players[state.nextBidderIndex] !== playerId) throw new Error('29:out_of_turn_bid');
  const calls = [...state.calls, { playerId, call }];
  const nextIndex = (state.nextBidderIndex + 1) % 4;

  if (call === 'pass') {
    if (state.highBid === null && calls.length === 3) {
      const forcedDealer = state.players[state.dealerIndex];
      return deepFreeze({
        ...state,
        calls: [...calls, { playerId: forcedDealer, call: state.minBid, forced: true }],
        highBid: state.minBid,
        highBidder: forcedDealer,
        consecutivePasses: 3,
        nextBidderIndex: state.dealerIndex,
        phase: 'trump-selection',
      });
    }
    const passes = state.consecutivePasses + 1;
    return deepFreeze({
      ...state,
      calls,
      consecutivePasses: passes,
      nextBidderIndex: nextIndex,
      phase: state.highBid !== null && passes >= 3 ? 'trump-selection' : 'auction',
    });
  }

  if (!Number.isInteger(call)) throw new Error('29:invalid_call');
  const minimum = state.highBid === null ? state.minBid : state.highBid + 1;
  if (call < minimum || call > state.maxBid) throw new Error('29:invalid_bid');
  return deepFreeze({
    ...state,
    calls,
    highBid: call,
    highBidder: playerId,
    consecutivePasses: 0,
    nextBidderIndex: nextIndex,
  });
}

export function chooseTwentyNineTrump(state, { playerId, trumpSuit }) {
  if (state.phase !== 'trump-selection') throw new Error('29:trump_not_ready');
  if (state.highBidder !== playerId) throw new Error('29:only_high_bidder_selects_trump');
  if (!SUITS.includes(trumpSuit)) throw new Error('29:invalid_trump');
  return deepFreeze({ ...state, trumpSuit, phase: 'awaiting-second-deal' });
}

export function completeTwentyNineDeal(state, { remainingHands }) {
  if (state.phase !== 'awaiting-second-deal' || !state.trumpSuit) throw new Error('29:trump_required_before_second_deal');
  validatePartialHands(state.players, remainingHands, 4);
  const fullHands = state.players.map((id, i) => [...state.firstFourHands[id], ...remainingHands[i]]);
  const actual = fullHands.flat().sort();
  const expected = [...makeDeck(TWENTY_NINE_RANKS)].sort();
  if (actual.length !== expected.length || actual.some((card, i) => card !== expected[i])) throw new Error('29:deck_mismatch');
  const bidderIndex = state.players.indexOf(state.highBidder);
  return deepFreeze({
    gameId: '29',
    players: [...state.players],
    hands: fullHands,
    dealerIndex: state.dealerIndex,
    leaderIndex: (state.dealerIndex + 1) % 4,
    bidderId: state.highBidder,
    bidderTeam: bidderIndex % 2,
    bid: state.highBid,
    trumpSuit: state.trumpSuit,
  });
}

export function adjustedTwentyNineContract({ bid, bidderTeam, pairTeam = null, minBid = 15, maxBid = 28 }) {
  if (!Number.isInteger(bid) || bid < minBid || bid > maxBid) throw new Error('29:invalid_bid');
  if (bidderTeam !== 0 && bidderTeam !== 1) throw new Error('29:invalid_bidder_team');
  if (pairTeam !== null && pairTeam !== 0 && pairTeam !== 1) throw new Error('29:invalid_pair_team');
  if (pairTeam === bidderTeam) return Math.max(minBid, bid - 4);
  if (pairTeam !== null) return Math.min(maxBid, bid + 4);
  return bid;
}

export function scoreTwentyNineHand({ bid, bidderTeam, teamPoints, pairTeam = null, minBid = 15, maxBid = 28 }) {
  if (!Array.isArray(teamPoints) || teamPoints.length !== 2 || !teamPoints.every(v => Number.isInteger(v) && v >= 0)) {
    throw new Error('29:invalid_team_points');
  }
  const total = teamPoints[0] + teamPoints[1];
  if (total !== 28 && total !== 29) throw new Error('29:invalid_point_total');
  const contract = adjustedTwentyNineContract({ bid, bidderTeam, pairTeam, minBid, maxBid });
  const success = teamPoints[bidderTeam] >= contract;
  return deepFreeze({
    contract,
    success,
    bidderTeam,
    winnerTeam: success ? bidderTeam : 1 - bidderTeam,
    bidderGamePointDelta: success ? 1 : -1,
  });
}
