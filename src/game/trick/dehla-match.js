function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

export function scoreDehlaPakadHand({
  dealerIndex,
  tensByTeam,
  previousStreakTeam = null,
  previousStreakHands = 0,
  kots = [0, 0],
}) {
  if (!Number.isInteger(dealerIndex) || dealerIndex < 0 || dealerIndex > 3) throw new Error('dehla:invalid_dealer');
  if (!Array.isArray(tensByTeam) || tensByTeam.length !== 2 || !tensByTeam.every(v => Number.isInteger(v) && v >= 0 && v <= 4)) {
    throw new Error('dehla:invalid_tens');
  }
  if (tensByTeam[0] + tensByTeam[1] !== 4) throw new Error('dehla:invalid_ten_total');
  if (previousStreakTeam !== null && previousStreakTeam !== 0 && previousStreakTeam !== 1) throw new Error('dehla:invalid_streak_team');
  if (!Number.isInteger(previousStreakHands) || previousStreakHands < 0 || previousStreakHands > 6) throw new Error('dehla:invalid_streak');
  if (!Array.isArray(kots) || kots.length !== 2 || !kots.every(v => Number.isInteger(v) && v >= 0)) throw new Error('dehla:invalid_kots');

  const dealerTeam = dealerIndex % 2;
  const nonDealerTeam = 1 - dealerTeam;
  const winnerTeam = tensByTeam[dealerTeam] >= 3 ? dealerTeam : nonDealerTeam;
  const immediateKot = tensByTeam[winnerTeam] === 4;
  let streakHands = previousStreakTeam === winnerTeam ? previousStreakHands + 1 : 1;
  const streakKot = !immediateKot && streakHands >= 7;
  const kotAward = immediateKot || streakKot ? 1 : 0;
  const updatedKots = [...kots];
  if (kotAward) {
    updatedKots[winnerTeam] += 1;
    streakHands = 0;
  }

  let nextDealerIndex;
  if (immediateKot) {
    nextDealerIndex = winnerTeam === dealerTeam ? (dealerIndex - 1 + 4) % 4 : (dealerIndex + 2) % 4;
  } else {
    nextDealerIndex = winnerTeam === dealerTeam ? (dealerIndex - 1 + 4) % 4 : dealerIndex;
  }

  return deepFreeze({
    winnerTeam,
    kotAward,
    kotReason: immediateKot ? 'four-tens' : streakKot ? 'seven-hands' : null,
    kots: updatedKots,
    streakTeam: kotAward ? null : winnerTeam,
    streakHands,
    nextDealerIndex,
  });
}
