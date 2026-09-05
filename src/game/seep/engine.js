import { SEEP_DECK, seepCardPoints, seepCardValue } from './cards.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function validatePlayers(players) {
  if (!Array.isArray(players) || players.length !== 4 || new Set(players).size !== 4) throw new Error('seep:four_unique_players_required');
  for (const id of players) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id)) throw new Error('seep:invalid_player');
  }
}

function validateCardList(cards, expectedLength, field) {
  if (!Array.isArray(cards) || cards.length !== expectedLength) throw new Error(`seep:${field}_invalid_length`);
  for (const card of cards) seepCardValue(card);
  if (new Set(cards).size !== cards.length) throw new Error(`seep:${field}_duplicate_card`);
}

function teamOf(state, playerId) {
  return state.players.indexOf(playerId) % 2;
}

function nextRight(index) {
  return (index - 1 + 4) % 4;
}

function cloneHands(state) {
  return Object.fromEntries(state.players.map(id => [id, [...state.hands[id]]]));
}

function cloneHouses(state) {
  return state.houses.map(house => ({
    id: house.id,
    value: house.value,
    layers: house.layers.map(layer => [...layer]),
    owners: [...house.owners],
    cemented: house.cemented,
  }));
}

function houseCards(house) {
  return house.layers.flat();
}

function currentZoneCards(state) {
  return [
    ...state.players.flatMap(id => state.hands[id]),
    ...state.floorLoose,
    ...state.floorHidden,
    ...state.houses.flatMap(houseCards),
    ...state.capturedTeams.flat(),
  ];
}

function ensureUniqueCards(cards) {
  for (const card of cards) seepCardValue(card);
  if (new Set(cards).size !== cards.length) throw new Error('seep:duplicate_card_across_state');
}

function hasSubsetSum(cards, target) {
  if (target <= 0) return false;
  const reachable = new Set([0]);
  for (const card of cards) {
    const value = seepCardValue(card);
    const additions = [];
    for (const sum of reachable) if (sum + value <= target) additions.push(sum + value);
    for (const sum of additions) reachable.add(sum);
    if (reachable.has(target)) return true;
  }
  return false;
}

function selectedLooseCards(state, selected) {
  if (!Array.isArray(selected)) throw new Error('seep:invalid_loose_selection');
  if (new Set(selected).size !== selected.length) throw new Error('seep:duplicate_loose_selection');
  for (const card of selected) if (!state.floorLoose.includes(card)) throw new Error('seep:loose_card_not_on_floor');
  return selected;
}

function removeCards(source, toRemove) {
  const remove = new Set(toRemove);
  return source.filter(card => !remove.has(card));
}

function hasCaptureForValue(state, value) {
  if (state.houses.some(house => house.value === value)) return true;
  return hasSubsetSum(state.floorLoose, value);
}

function hasOpeningBuild(state) {
  const bidderId = state.players[state.bidderIndex];
  const bid = state.openingBid;
  const hand = state.hands[bidderId];
  return hand.some(card => {
    const playedValue = seepCardValue(card);
    const remaining = hand.filter(held => held !== card);
    if (!remaining.some(held => seepCardValue(held) === bid)) return false;
    const needed = bid - playedValue;
    return needed > 0 && hasSubsetSum(state.floorLoose, needed);
  });
}

function requireHouseReserve(state, hands, houses) {
  for (const house of houses) {
    for (const owner of house.owners) {
      if (!hands[owner].some(card => seepCardValue(card) === house.value)) {
        throw new Error('seep:house_owner_must_retain_capture_card');
      }
    }
  }
}

function autoCementExactLoose(house, floorLoose) {
  const exact = floorLoose.filter(card => seepCardValue(card) === house.value);
  if (exact.length === 0) return { house, floorLoose };
  return {
    house: {
      ...house,
      layers: [...house.layers, ...exact.map(card => [card])],
      cemented: true,
    },
    floorLoose: removeCards(floorLoose, exact),
  };
}

function validateCaptureGroups(state, groups, value) {
  if (!Array.isArray(groups)) throw new Error('seep:invalid_capture_groups');
  const used = [];
  for (const group of groups) {
    if (!Array.isArray(group) || group.length === 0) throw new Error('seep:empty_capture_group');
    selectedLooseCards(state, group);
    if (group.reduce((sum, card) => sum + seepCardValue(card), 0) !== value) throw new Error('seep:capture_group_wrong_value');
    used.push(...group);
  }
  if (new Set(used).size !== used.length) throw new Error('seep:overlapping_capture_groups');
  return used;
}

function applyAction(state, playerId, action, { opening = false } = {}) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('seep:invalid_action');
  if (typeof action.card !== 'string') throw new Error('seep:card_required');
  if (!state.hands[playerId].includes(action.card)) throw new Error('seep:card_not_owned');

  const hands = cloneHands(state);
  hands[playerId].splice(hands[playerId].indexOf(action.card), 1);
  let floorLoose = [...state.floorLoose];
  let houses = cloneHouses(state);
  const capturedTeams = state.capturedTeams.map(cards => [...cards]);
  const sweepPoints = [...state.sweepPoints];
  let lastCaptureTeam = state.lastCaptureTeam;
  let nextHouseId = state.nextHouseId;
  const playedValue = seepCardValue(action.card);
  const team = teamOf(state, playerId);
  let captureOccurred = false;

  if (opening && action.type !== 'build' && playedValue !== state.openingBid) throw new Error('seep:opening_card_must_match_bid');

  if (action.type === 'throw') {
    if (hasCaptureForValue(state, playedValue)) throw new Error('seep:capture_required');
    if (opening && hasOpeningBuild(state)) throw new Error('seep:opening_house_required_when_available');
    floorLoose.push(action.card);
  } else if (action.type === 'capture') {
    const expectedHouseIds = houses.filter(house => house.value === playedValue).map(house => house.id).sort();
    const suppliedHouseIds = Array.isArray(action.houseIds) ? [...new Set(action.houseIds)].sort() : [];
    if (suppliedHouseIds.length !== (action.houseIds?.length ?? 0)) throw new Error('seep:duplicate_house_capture');
    if (JSON.stringify(expectedHouseIds) !== JSON.stringify(suppliedHouseIds)) throw new Error('seep:all_matching_houses_required');
    const looseUsed = validateCaptureGroups(state, action.looseGroups ?? [], playedValue);
    const remainingLoose = removeCards(floorLoose, looseUsed);
    if (hasSubsetSum(remainingLoose, playedValue)) throw new Error('seep:all_possible_loose_captures_required');
    if (expectedHouseIds.length === 0 && looseUsed.length === 0) throw new Error('seep:nothing_to_capture');
    const capturedHouseCards = houses.filter(house => expectedHouseIds.includes(house.id)).flatMap(houseCards);
    houses = houses.filter(house => !expectedHouseIds.includes(house.id));
    floorLoose = remainingLoose;
    capturedTeams[team].push(action.card, ...capturedHouseCards, ...looseUsed);
    captureOccurred = true;
    lastCaptureTeam = team;
  } else if (action.type === 'build') {
    const target = action.targetValue;
    if (!Number.isInteger(target) || target < 9 || target > 13) throw new Error('seep:invalid_house_value');
    if (opening && target !== state.openingBid) throw new Error('seep:opening_house_must_match_bid');
    const loose = selectedLooseCards(state, action.looseCards ?? []);
    if (loose.length === 0) throw new Error('seep:house_needs_floor_cards');
    if (playedValue + loose.reduce((sum, card) => sum + seepCardValue(card), 0) !== target) throw new Error('seep:house_wrong_value');
    if (!hands[playerId].some(card => seepCardValue(card) === target)) throw new Error('seep:house_capture_card_required');
    floorLoose = removeCards(floorLoose, loose);
    const existingIndex = houses.findIndex(house => house.value === target);
    if (existingIndex >= 0) {
      const existing = houses[existingIndex];
      let updated = {
        ...existing,
        layers: [...existing.layers, [action.card, ...loose]],
        owners: [...new Set([...existing.owners, playerId])],
        cemented: true,
      };
      const auto = autoCementExactLoose(updated, floorLoose);
      updated = auto.house;
      floorLoose = auto.floorLoose;
      houses[existingIndex] = updated;
    } else {
      let created = {
        id: `h${nextHouseId}`,
        value: target,
        layers: [[action.card, ...loose]],
        owners: [playerId],
        cemented: false,
      };
      nextHouseId += 1;
      const auto = autoCementExactLoose(created, floorLoose);
      created = auto.house;
      floorLoose = auto.floorLoose;
      houses.push(created);
    }
  } else if (action.type === 'break') {
    const index = houses.findIndex(house => house.id === action.houseId);
    if (index < 0) throw new Error('seep:unknown_house');
    const existing = houses[index];
    if (existing.cemented) throw new Error('seep:cemented_house_cannot_break');
    const target = existing.value + playedValue;
    if (target < 9 || target > 13 || action.newValue !== target) throw new Error('seep:invalid_break_value');
    if (!hands[playerId].some(card => seepCardValue(card) === target)) throw new Error('seep:house_capture_card_required');
    houses.splice(index, 1);
    const mergedLayer = [...houseCards(existing), action.card];
    const sameIndex = houses.findIndex(house => house.value === target);
    if (sameIndex >= 0) {
      let updated = {
        ...houses[sameIndex],
        layers: [...houses[sameIndex].layers, mergedLayer],
        owners: [...new Set([...houses[sameIndex].owners, playerId])],
        cemented: true,
      };
      const auto = autoCementExactLoose(updated, floorLoose);
      updated = auto.house;
      floorLoose = auto.floorLoose;
      houses[sameIndex] = updated;
    } else {
      let updated = { id: existing.id, value: target, layers: [mergedLayer], owners: [playerId], cemented: false };
      const auto = autoCementExactLoose(updated, floorLoose);
      updated = auto.house;
      floorLoose = auto.floorLoose;
      houses.push(updated);
    }
  } else if (action.type === 'cement') {
    const index = houses.findIndex(house => house.id === action.houseId);
    if (index < 0) throw new Error('seep:unknown_house');
    const existing = houses[index];
    const loose = selectedLooseCards(state, action.looseCards ?? []);
    const layerValue = playedValue + loose.reduce((sum, card) => sum + seepCardValue(card), 0);
    if (layerValue !== existing.value) throw new Error('seep:cement_layer_wrong_value');
    if (!hands[playerId].some(card => seepCardValue(card) === existing.value)) throw new Error('seep:house_capture_card_required');
    floorLoose = removeCards(floorLoose, loose);
    let updated = {
      ...existing,
      layers: [...existing.layers, [action.card, ...loose]],
      owners: [...new Set([...existing.owners, playerId])],
      cemented: true,
    };
    const auto = autoCementExactLoose(updated, floorLoose);
    updated = auto.house;
    floorLoose = auto.floorLoose;
    houses[index] = updated;
  } else {
    throw new Error('seep:unsupported_action');
  }

  requireHouseReserve(state, hands, houses);
  const finalPlay = state.phase === 'play' && state.players.every(id => hands[id].length === 0);
  if (captureOccurred && floorLoose.length === 0 && houses.length === 0) {
    const bonus = opening ? 25 : finalPlay ? 0 : 50;
    sweepPoints[team] += bonus;
  }

  return {
    hands,
    floorLoose,
    houses,
    capturedTeams,
    sweepPoints,
    lastCaptureTeam,
    nextHouseId,
    captureOccurred,
    finalPlay,
  };
}

export function createSeepOpening({ players, dealerIndex, bidderHand, floorCards }) {
  validatePlayers(players);
  if (!Number.isInteger(dealerIndex) || dealerIndex < 0 || dealerIndex > 3) throw new Error('seep:invalid_dealer');
  validateCardList(bidderHand, 4, 'bidder_hand');
  validateCardList(floorCards, 4, 'floor');
  ensureUniqueCards([...bidderHand, ...floorCards]);
  const bidderIndex = nextRight(dealerIndex);
  const hands = Object.fromEntries(players.map(id => [id, []]));
  hands[players[bidderIndex]] = [...bidderHand];
  return deepFreeze({
    version: 1,
    players: [...players],
    dealerIndex,
    bidderIndex,
    currentPlayerIndex: bidderIndex,
    hands,
    floorHidden: [...floorCards],
    floorLoose: [],
    houses: [],
    capturedTeams: [[], []],
    sweepPoints: [0, 0],
    lastCaptureTeam: null,
    openingBid: null,
    nextHouseId: 1,
    turnNumber: 0,
    phase: 'bid',
  });
}

export function submitSeepBid(state, { playerId, bid }) {
  if (state.phase !== 'bid') throw new Error('seep:bid_not_available');
  if (state.players[state.bidderIndex] !== playerId) throw new Error('seep:only_bidder_can_bid');
  if (!Number.isInteger(bid) || bid < 9 || bid > 13) throw new Error('seep:invalid_bid');
  if (!state.hands[playerId].some(card => seepCardValue(card) === bid)) throw new Error('seep:bid_card_required');
  return deepFreeze({
    ...state,
    openingBid: bid,
    floorLoose: [...state.floorHidden],
    floorHidden: [],
    phase: 'opening-play',
  });
}

export function playSeepTurn(state, { playerId, action }) {
  const opening = state.phase === 'opening-play';
  if (!opening && state.phase !== 'play') throw new Error('seep:play_not_available');
  if (state.players[state.currentPlayerIndex] !== playerId) throw new Error('seep:out_of_turn');
  const result = applyAction(state, playerId, action, { opening });

  if (opening) {
    return deepFreeze({
      ...state,
      ...result,
      turnNumber: 1,
      phase: 'awaiting-remainder',
    });
  }

  if (result.finalPlay) {
    if (result.houses.length !== 0) throw new Error('seep:house_left_at_end');
    let floorLoose = result.floorLoose;
    const capturedTeams = result.capturedTeams.map(cards => [...cards]);
    if (floorLoose.length > 0) {
      if (result.lastCaptureTeam === null) throw new Error('seep:no_last_capture_for_floor');
      capturedTeams[result.lastCaptureTeam].push(...floorLoose);
      floorLoose = [];
    }
    return deepFreeze({
      ...state,
      ...result,
      floorLoose,
      capturedTeams,
      currentPlayerIndex: state.currentPlayerIndex,
      turnNumber: state.turnNumber + 1,
      phase: 'finished',
    });
  }

  return deepFreeze({
    ...state,
    ...result,
    currentPlayerIndex: nextRight(state.currentPlayerIndex),
    turnNumber: state.turnNumber + 1,
  });
}

export function completeSeepDeal(state, { remainingHands }) {
  if (state.phase !== 'awaiting-remainder') throw new Error('seep:remainder_not_ready');
  if (!Array.isArray(remainingHands) || remainingHands.length !== 4) throw new Error('seep:invalid_remaining_hands');
  for (let i = 0; i < 4; i += 1) {
    const expected = i === state.bidderIndex ? 8 : 12;
    validateCardList(remainingHands[i], expected, 'remaining');
  }
  const existing = currentZoneCards(state);
  const combined = [...existing, ...remainingHands.flat()];
  ensureUniqueCards(combined);
  const actual = [...combined].sort();
  const expectedDeck = [...SEEP_DECK].sort();
  if (actual.length !== 52 || actual.some((card, index) => card !== expectedDeck[index])) throw new Error('seep:deck_mismatch');
  const hands = cloneHands(state);
  for (let i = 0; i < 4; i += 1) hands[state.players[i]].push(...remainingHands[i]);
  if (hands[state.players[state.bidderIndex]].length !== 11) throw new Error('seep:bidder_hand_size_after_deal');
  for (let i = 0; i < 4; i += 1) if (i !== state.bidderIndex && hands[state.players[i]].length !== 12) throw new Error('seep:hand_size_after_deal');
  return deepFreeze({
    ...state,
    hands,
    currentPlayerIndex: nextRight(state.bidderIndex),
    phase: 'play',
  });
}

export function projectSeepState(state, viewerId = null) {
  if (viewerId !== null && !state.players.includes(viewerId)) throw new Error('seep:unknown_viewer');
  return deepFreeze({
    version: state.version,
    phase: state.phase,
    dealerIndex: state.dealerIndex,
    bidderIndex: state.bidderIndex,
    currentPlayerIndex: state.currentPlayerIndex,
    openingBid: state.openingBid,
    floor: state.phase === 'bid' ? null : [...state.floorLoose],
    floorCount: state.phase === 'bid' ? state.floorHidden.length : state.floorLoose.length,
    houses: state.houses.map(house => ({ id: house.id, value: house.value, layers: house.layers.map(layer => [...layer]), cemented: house.cemented })),
    seats: state.players.map((playerId, index) => ({
      playerId,
      index,
      handCount: state.hands[playerId].length,
      ...(playerId === viewerId ? { hand: [...state.hands[playerId]] } : {}),
    })),
    capturedCounts: state.capturedTeams.map(cards => cards.length),
    sweepPoints: [...state.sweepPoints],
    turnNumber: state.turnNumber,
  });
}

export function scoreSeepHand(state) {
  if (state.phase !== 'finished') throw new Error('seep:hand_not_finished');
  const basePoints = state.capturedTeams.map(cards => cards.reduce((sum, card) => sum + seepCardPoints(card), 0));
  if (basePoints[0] + basePoints[1] !== 100) throw new Error('seep:base_point_conservation_failed');
  const scores = basePoints.map((value, team) => value + state.sweepPoints[team]);
  return deepFreeze({ basePoints, sweepPoints: [...state.sweepPoints], scores });
}

export function updateSeepMatch({ dealerIndex, handScores, runningDifference = 0, baazis = [0, 0] }) {
  if (!Number.isInteger(dealerIndex) || dealerIndex < 0 || dealerIndex > 3) throw new Error('seep:invalid_dealer');
  if (!Array.isArray(handScores) || handScores.length !== 2 || !handScores.every(v => Number.isInteger(v) && v >= 0)) throw new Error('seep:invalid_hand_scores');
  if (!Number.isInteger(runningDifference)) throw new Error('seep:invalid_running_difference');
  if (!Array.isArray(baazis) || baazis.length !== 2 || !baazis.every(v => Number.isInteger(v) && v >= 0)) throw new Error('seep:invalid_baazis');

  const rawDifference = runningDifference + handScores[0] - handScores[1];
  let baaziWinner = null;
  if (handScores[0] < 9) baaziWinner = 1;
  else if (handScores[1] < 9) baaziWinner = 0;
  else if (rawDifference >= 100) baaziWinner = 0;
  else if (rawDifference <= -100) baaziWinner = 1;

  const dealerTeam = dealerIndex % 2;
  const leadingTeam = rawDifference === 0 ? null : rawDifference > 0 ? 0 : 1;
  const normalNextDealer = leadingTeam !== null && leadingTeam === dealerTeam ? nextRight(dealerIndex) : dealerIndex;
  const updatedBaazis = [...baazis];
  if (baaziWinner !== null) updatedBaazis[baaziWinner] += 1;
  return deepFreeze({
    runningDifference: baaziWinner === null ? rawDifference : 0,
    baaziWinner,
    baazis: updatedBaazis,
    nextDealerIndex: baaziWinner === null ? normalNextDealer : (normalNextDealer + 2) % 4,
  });
}
