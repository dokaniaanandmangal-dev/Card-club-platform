export const CLUB_REVENUE_PERCENT = 1;

const rawGames = [
  {
    id: 'marriage-21',
    name: '21-Card Marriage',
    family: 'marriage',
    settlementClass: 'variable',
    players: '2–5',
    phase: 'Arrange melds',
    status: 'Joker not seen',
    detail: '21-card hand, meld trays, joker/maal status and declaration flow.',
  },
  {
    id: 'spades',
    name: 'Spades',
    family: 'trick',
    settlementClass: 'fixed',
    players: '4',
    phase: 'Bidding',
    status: '♠ Always trump',
    detail: 'Partnership bidding, visible contract score and clean trick center.',
  },
  {
    id: 'hearts',
    name: 'Hearts',
    family: 'trick',
    settlementClass: 'fixed',
    players: '4',
    phase: 'Pass 3 cards',
    status: 'Avoid ♥ and Q♠',
    detail: 'Dedicated passing phase with persistent penalty score.',
  },
  {
    id: '29',
    name: '29',
    family: 'trick',
    settlementClass: 'fixed',
    players: '4',
    phase: 'Bid 19',
    status: 'Trump hidden',
    detail: 'Partnership bidding with hidden-trump state and compact score.',
  },
  {
    id: 'sweep',
    name: 'Sweep / Seep',
    family: 'capture',
    settlementClass: 'fixed',
    players: '2 / 4',
    phase: 'Capture floor',
    status: 'Target 100',
    detail: 'Large center floor, capture targets and point-card emphasis.',
  },
  {
    id: 'court-piece',
    name: 'Court Piece',
    family: 'trick',
    settlementClass: 'fixed',
    players: '4',
    phase: 'Call trump',
    status: 'Caller choosing',
    detail: 'Caller/trump indicator with simple partnership trick play.',
  },
  {
    id: 'dehla-pakad',
    name: 'Dehla Pakad',
    family: 'trick',
    settlementClass: 'fixed',
    players: '4',
    phase: 'Play trick',
    status: 'Catch the 10s',
    detail: 'Team layout with high-visibility tens and Hide/Cut mode state.',
  },
  {
    id: 'poker',
    name: 'Poker',
    family: 'betting',
    settlementClass: 'variable',
    players: '2–9',
    phase: 'Your action',
    status: 'Pot 4,800',
    detail: 'Oval table, stack/pot hierarchy and contextual fold/call/raise actions.',
  },
  {
    id: 'teen-patti',
    name: 'Teen Patti / 3 Patti',
    family: 'betting',
    settlementClass: 'variable',
    players: '3–5',
    phase: 'Chaal',
    status: 'Seen · Pot 3,200',
    detail: 'Five-seat social table with blind/seen state and compact betting controls.',
  },
];

function deepFreezeGame(game) {
  return Object.freeze({
    ...game,
    revenuePercent: CLUB_REVENUE_PERCENT,
    revenueLabel: game.settlementClass === 'fixed'
      ? '1% board fee'
      : '1% winner cut',
  });
}

export const GAMES = Object.freeze(rawGames.map(deepFreezeGame));

export function getGame(id) {
  return GAMES.find(game => game.id === id) ?? null;
}
