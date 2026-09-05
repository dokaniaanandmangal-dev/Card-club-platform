function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function directionForHand(handNumber) {
  const cycle = ((handNumber % 4) + 4) % 4;
  return ['left', 'right', 'across', 'none'][cycle];
}

export function createHeartsPassState({ players, hands, handNumber }) {
  if (!Array.isArray(players) || players.length !== 4 || new Set(players).size !== 4) throw new Error('hearts:four_unique_players_required');
  if (!Array.isArray(hands) || hands.length !== 4 || !hands.every(hand => Array.isArray(hand) && hand.length === 13)) {
    throw new Error('hearts:invalid_hands');
  }
  if (!Number.isInteger(handNumber) || handNumber < 0) throw new Error('hearts:invalid_hand_number');
  return deepFreeze({
    players: [...players],
    hands: Object.fromEntries(players.map((id, i) => [id, [...hands[i]]])),
    direction: directionForHand(handNumber),
    selections: {},
    complete: directionForHand(handNumber) === 'none',
  });
}

export function submitHeartsPass(state, { playerId, cards }) {
  if (state.direction === 'none') throw new Error('hearts:no_pass_this_hand');
  if (state.complete) throw new Error('hearts:passing_complete');
  if (!state.players.includes(playerId)) throw new Error('hearts:unknown_player');
  if (Object.hasOwn(state.selections, playerId)) throw new Error('hearts:pass_already_submitted');
  if (!Array.isArray(cards) || cards.length !== 3 || new Set(cards).size !== 3) throw new Error('hearts:exactly_three_cards_required');
  if (!cards.every(card => state.hands[playerId].includes(card))) throw new Error('hearts:card_not_owned');
  const selections = { ...state.selections, [playerId]: [...cards] };
  return deepFreeze({ ...state, selections, complete: Object.keys(selections).length === 4 });
}

export function applyHeartsPass(state) {
  if (state.direction === 'none') return deepFreeze(state.players.map(id => [...state.hands[id]]));
  if (!state.complete || Object.keys(state.selections).length !== 4) throw new Error('hearts:all_passes_required');
  const nextHands = Object.fromEntries(state.players.map(id => [id, state.hands[id].filter(card => !state.selections[id].includes(card))]));
  const offset = state.direction === 'left' ? 1 : state.direction === 'right' ? -1 : 2;
  for (let i = 0; i < 4; i += 1) {
    const recipient = state.players[(i + offset + 4) % 4];
    nextHands[recipient].push(...state.selections[state.players[i]]);
  }
  for (const id of state.players) if (nextHands[id].length !== 13 || new Set(nextHands[id]).size !== 13) throw new Error('hearts:pass_integrity_failure');
  return deepFreeze(state.players.map(id => [...nextHands[id]]));
}

export function scoreHeartsHand({ players, adjustedPenalties, previousScores = [0, 0, 0, 0], target = 100 }) {
  if (!Array.isArray(players) || players.length !== 4) throw new Error('hearts:invalid_players');
  if (!Number.isInteger(target) || target < 1) throw new Error('hearts:invalid_target');
  if (!Array.isArray(previousScores) || previousScores.length !== 4 || !previousScores.every(v => Number.isInteger(v) && v >= 0)) {
    throw new Error('hearts:invalid_scores');
  }
  const scores = players.map((id, index) => {
    const penalty = adjustedPenalties[id];
    if (!Number.isInteger(penalty) || penalty < 0) throw new Error('hearts:invalid_penalty');
    return previousScores[index] + penalty;
  });
  const finished = scores.some(score => score >= target);
  let winnerIndex = null;
  if (finished) {
    const minimum = Math.min(...scores);
    const winners = scores.map((score, index) => score === minimum ? index : -1).filter(index => index >= 0);
    winnerIndex = winners.length === 1 ? winners[0] : null;
  }
  return deepFreeze({ scores, finished, winnerIndex });
}
