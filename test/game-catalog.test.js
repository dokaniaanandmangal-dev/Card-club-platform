import test from 'node:test';
import assert from 'node:assert/strict';
import { CLUB_REVENUE_PERCENT, GAMES, getGame } from '../src/ui/game-catalog.js';

test('approved catalogue contains exactly the nine owner-selected games', () => {
  assert.equal(GAMES.length, 9);
  assert.deepEqual(GAMES.map(game => game.id), [
    'marriage-21',
    'spades',
    'hearts',
    '29',
    'sweep',
    'court-piece',
    'dehla-pakad',
    'poker',
    'teen-patti',
  ]);
});

test('fixed and variable revenue policy is exactly 1 percent with no 2.5 percent residue', () => {
  assert.equal(CLUB_REVENUE_PERCENT, 1);
  for (const game of GAMES) {
    assert.equal(game.revenuePercent, 1);
    assert.equal(game.revenueLabel, game.settlementClass === 'fixed' ? '1% board fee' : '1% winner cut');
    assert.doesNotMatch(JSON.stringify(game), /2\.5/);
  }
});

test('settlement classification matches approved product policy', () => {
  const fixed = GAMES.filter(game => game.settlementClass === 'fixed').map(game => game.id);
  const variable = GAMES.filter(game => game.settlementClass === 'variable').map(game => game.id);
  assert.deepEqual(fixed, ['spades', 'hearts', '29', 'sweep', 'court-piece', 'dehla-pakad']);
  assert.deepEqual(variable, ['marriage-21', 'poker', 'teen-patti']);
  assert.equal(getGame('poker')?.family, 'betting');
  assert.equal(getGame('missing'), null);
});
