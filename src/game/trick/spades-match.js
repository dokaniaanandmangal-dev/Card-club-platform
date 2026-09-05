function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

export function createSpadesBidState(players) {
  if (!Array.isArray(players) || players.length !== 4 || new Set(players).size !== 4) {
    throw new Error('spades:four_unique_players_required');
  }
  return deepFreeze({ players: [...players], nextBidderIndex: 0, bids: {}, complete: false });
}

export function submitSpadesBid(state, { playerId, bid }) {
  if (state.complete) throw new Error('spades:bidding_complete');
  if (state.players[state.nextBidderIndex] !== playerId) throw new Error('spades:out_of_turn_bid');
  if (!Number.isInteger(bid) || bid < 0 || bid > 13) throw new Error('spades:invalid_bid');
  const bids = { ...state.bids, [playerId]: bid };
  const next = state.nextBidderIndex + 1;
  return deepFreeze({
    ...state,
    bids,
    nextBidderIndex: next % 4,
    complete: next === 4,
  });
}

export function scoreSpadesHand({
  players,
  bids,
  teamTricks,
  playerTricks,
  previousScores = [0, 0],
  previousBags = [0, 0],
}) {
  if (!Array.isArray(players) || players.length !== 4) throw new Error('spades:invalid_players');
  if (!Array.isArray(teamTricks) || teamTricks.length !== 2 || teamTricks[0] + teamTricks[1] !== 13) {
    throw new Error('spades:invalid_tricks');
  }
  if (!Array.isArray(previousScores) || previousScores.length !== 2 || !previousScores.every(Number.isInteger)) {
    throw new Error('spades:invalid_scores');
  }
  if (!Array.isArray(previousBags) || previousBags.length !== 2 || !previousBags.every(v => Number.isInteger(v) && v >= 0 && v < 10)) {
    throw new Error('spades:invalid_bags');
  }
  if (!Array.isArray(playerTricks) || playerTricks.length !== 4 || !playerTricks.every(v => Number.isInteger(v) && v >= 0 && v <= 13)) {
    throw new Error('spades:invalid_player_tricks');
  }
  if (playerTricks.reduce((a, b) => a + b, 0) !== 13) throw new Error('spades:invalid_player_trick_total');
  if (playerTricks[0] + playerTricks[2] !== teamTricks[0] || playerTricks[1] + playerTricks[3] !== teamTricks[1]) {
    throw new Error('spades:team_trick_mismatch');
  }

  const scores = [...previousScores];
  const bags = [...previousBags];
  for (let team = 0; team < 2; team += 1) {
    const memberSeats = [team, team + 2];
    const members = memberSeats.map(seat => players[seat]);
    const contract = members.reduce((sum, id) => {
      const bid = bids[id];
      if (!Number.isInteger(bid) || bid < 0 || bid > 13) throw new Error('spades:missing_or_invalid_bid');
      return sum + bid;
    }, 0);

    if (teamTricks[team] >= contract) {
      scores[team] += contract * 10;
      const handBags = teamTricks[team] - contract;
      scores[team] += handBags;
      bags[team] += handBags;
      while (bags[team] >= 10) {
        scores[team] -= 100;
        bags[team] -= 10;
      }
    } else {
      scores[team] -= contract * 10;
    }

    for (const seat of memberSeats) {
      if (bids[players[seat]] !== 0) continue;
      scores[team] += playerTricks[seat] === 0 ? 100 : -100;
    }
  }
  return deepFreeze({ scores, bags });
}
