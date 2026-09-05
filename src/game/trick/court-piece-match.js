function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function validatePlayers(players) {
  if (!Array.isArray(players) || players.length !== 4 || new Set(players).size !== 4) throw new Error('court:invalid_players');
}

export function scoreCourtPieceDeal({
  players,
  dealerIndex,
  trickWinnerIds,
  previousStreakTeam = null,
  previousStreakDeals = 0,
  courts = [0, 0],
}) {
  validatePlayers(players);
  if (!Number.isInteger(dealerIndex) || dealerIndex < 0 || dealerIndex > 3) throw new Error('court:invalid_dealer');
  if (!Array.isArray(trickWinnerIds) || trickWinnerIds.length !== 13 || !trickWinnerIds.every(id => players.includes(id))) {
    throw new Error('court:invalid_trick_winners');
  }
  if (previousStreakTeam !== null && previousStreakTeam !== 0 && previousStreakTeam !== 1) throw new Error('court:invalid_streak_team');
  if (!Number.isInteger(previousStreakDeals) || previousStreakDeals < 0 || previousStreakDeals > 6) throw new Error('court:invalid_streak');
  if (!Array.isArray(courts) || courts.length !== 2 || !courts.every(v => Number.isInteger(v) && v >= 0)) throw new Error('court:invalid_courts');

  const teamTricks = [0, 0];
  for (const id of trickWinnerIds) teamTricks[players.indexOf(id) % 2] += 1;
  const winnerTeam = teamTricks[0] >= 7 ? 0 : 1;
  const firstSevenTeam = trickWinnerIds.slice(0, 7).every(id => players.indexOf(id) % 2 === winnerTeam) ? winnerTeam : null;
  const allThirteen = teamTricks[winnerTeam] === 13;

  let streakDeals = previousStreakTeam === winnerTeam ? previousStreakDeals + 1 : 1;
  let courtAward = 0;
  let courtReason = null;
  if (allThirteen) {
    courtAward = 52;
    courtReason = 'bavney';
  } else if (firstSevenTeam !== null) {
    courtAward = 1;
    courtReason = 'first-seven';
  } else if (streakDeals >= 7) {
    courtAward = 1;
    courtReason = 'seven-deals';
  }

  const updatedCourts = [...courts];
  if (courtAward > 0) {
    updatedCourts[winnerTeam] += courtAward;
    streakDeals = 0;
  }

  const dealerTeam = dealerIndex % 2;
  const callerIndex = (dealerIndex - 1 + 4) % 4;
  let nextDealerIndex;
  if (winnerTeam === dealerTeam) nextDealerIndex = callerIndex;
  else if (courtAward > 0) nextDealerIndex = (dealerIndex + 2) % 4;
  else nextDealerIndex = dealerIndex;

  return deepFreeze({
    teamTricks,
    winnerTeam,
    courtAward,
    courtReason,
    courts: updatedCourts,
    streakTeam: courtAward > 0 ? null : winnerTeam,
    streakDeals,
    nextDealerIndex,
  });
}
