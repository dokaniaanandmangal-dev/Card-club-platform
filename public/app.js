import { GAMES } from '/game-catalog.js';

const grid = document.querySelector('#game-grid');
const preview = document.querySelector('#preview');

const ranks = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3'];
const suits = ['♠', '♥', '♣', '♦'];

function card(rank, suit, extra = '') {
  const red = suit === '♥' || suit === '♦' ? ' red' : '';
  return `<div class="card${red}${extra ? ` ${extra}` : ''}" aria-label="${rank}${suit}">${rank}${suit}</div>`;
}

function backCard() {
  return '<div class="card back" aria-label="hidden card"></div>';
}

function sampleHand(count, offset = 0) {
  return Array.from({ length: count }, (_, index) => {
    const rank = ranks[(index + offset) % ranks.length];
    const suit = suits[(index + offset) % suits.length];
    return card(rank, suit, rank === '10' ? 'objective' : '');
  }).join('');
}

function seats(game) {
  if (game.family === 'betting' && game.id === 'poker') {
    return `
      <div class="seat top-left"><div class="avatar">A</div>Asha<small>8,900</small></div>
      <div class="seat top"><div class="avatar">R</div>Ravi<small>12,400</small></div>
      <div class="seat top-right"><div class="avatar">M</div>Meera<small>6,700</small></div>
      <div class="seat left"><div class="avatar">K</div>Karan<small>10,100</small></div>
      <div class="seat right"><div class="avatar">N</div>Nina<small>9,300</small></div>
      <div class="seat bottom"><div class="avatar">Y</div>You<small>11,250</small></div>`;
  }
  if (game.family === 'betting') {
    return `
      <div class="seat top-left"><div class="avatar">A</div>Asha<small>Blind</small></div>
      <div class="seat top"><div class="avatar">R</div>Ravi<small>Seen</small></div>
      <div class="seat top-right"><div class="avatar">M</div>Meera<small>Blind</small></div>
      <div class="seat right"><div class="avatar">N</div>Nina<small>Seen</small></div>
      <div class="seat bottom"><div class="avatar">Y</div>You<small>Seen</small></div>`;
  }
  return `
    <div class="seat top"><div class="avatar">P</div>Partner<small>Ready</small></div>
    <div class="seat left"><div class="avatar">L</div>Left<small>Connected</small></div>
    <div class="seat right"><div class="avatar">R</div>Right<small>Connected</small></div>
    <div class="seat bottom"><div class="avatar">Y</div>You<small>Your turn</small></div>`;
}

function center(game) {
  const head = `<div class="phase">${game.phase}</div><div class="center-status">${game.status}</div>`;

  if (game.family === 'capture') {
    return `<div class="center-stack">${head}<div class="floor">${card('10','♦','objective')}${card('K','♠')}${card('7','♥')}${card('A','♣','objective')}${card('4','♦')}${card('9','♠')}</div></div>`;
  }

  if (game.family === 'marriage') {
    return `<div class="center-stack">${head}<div class="melds"><div class="meld">PURE SEQUENCE</div><div class="meld">TUNNELLA</div><div class="meld">OPEN MELD</div></div></div>`;
  }

  if (game.family === 'betting') {
    const community = game.id === 'poker'
      ? `${card('A','♠')}${card('10','♥')}${card('7','♣')}${backCard()}${backCard()}`
      : `${backCard()}${backCard()}${backCard()}`;
    return `<div class="center-stack">${head}<div class="community">${community}</div></div>`;
  }

  const objective = game.id === 'dehla-pakad' ? ' objective' : '';
  return `<div class="center-stack">${head}<div class="trick">${card('10','♠', objective.trim())}${card('K','♥')}${card('7','♣')}${backCard()}</div></div>`;
}

function actions(game) {
  if (game.id === 'spades') return '<div class="actions"><button class="action">Nil</button><button class="action">3</button><button class="action primary">4</button><button class="action">5</button></div>';
  if (game.id === 'hearts') return '<div class="actions"><button class="action primary">Pass selected 3</button></div>';
  if (game.id === '29') return '<div class="actions"><button class="action">Pass</button><button class="action">20</button><button class="action primary">21</button></div>';
  if (game.id === 'court-piece') return '<div class="actions"><button class="action">♣</button><button class="action danger">♥</button><button class="action">♠</button><button class="action danger">♦</button></div>';
  if (game.family === 'capture') return '<div class="actions"><button class="action">Build</button><button class="action primary">Capture</button></div>';
  if (game.family === 'marriage') return '<div class="actions"><button class="action">Group</button><button class="action">Show</button><button class="action primary">Discard</button></div>';
  if (game.family === 'betting') return '<div class="actions"><button class="action danger">Fold</button><button class="action">Call</button><button class="action primary">Raise</button></div>';
  return '<div class="actions"><button class="action primary">Play selected card</button></div>';
}

function hand(game) {
  if (game.family === 'marriage') return sampleHand(16, 1);
  if (game.id === 'poker') return `${card('A','♦')}${card('K','♦')}`;
  if (game.id === 'teen-patti') return `${card('Q','♠')}${card('Q','♥')}${card('8','♣')}`;
  return sampleHand(11, 2);
}

function renderPreview(game) {
  preview.innerHTML = `
    <div class="preview-head">
      <div>
        <div class="eyebrow">${game.family.toUpperCase()} SHELL</div>
        <h2>${game.name}</h2>
        <p>${game.detail}</p>
      </div>
      <div class="preview-meta">
        <span class="badge">${game.players} players</span>
        <span class="badge">${game.settlementClass} win</span>
        <span class="badge">${game.revenueLabel}</span>
      </div>
    </div>
    <div class="table-wrap">
      <div class="table" role="img" aria-label="Prototype ${game.name} table">
        ${seats(game)}
        <div class="center">${center(game)}</div>
        <div class="hand" aria-label="Your hand">${hand(game)}</div>
        ${actions(game)}
      </div>
    </div>`;
}

function selectGame(id) {
  const game = GAMES.find(item => item.id === id) ?? GAMES[0];
  for (const button of grid.querySelectorAll('.game-card')) {
    button.classList.toggle('selected', button.dataset.gameId === game.id);
  }
  renderPreview(game);
}

grid.innerHTML = GAMES.map(game => `
  <button class="game-card" type="button" data-game-id="${game.id}" aria-label="Preview ${game.name}">
    <strong>${game.name}</strong>
    <div class="meta"><span>${game.players} players</span><span>${game.revenueLabel}</span></div>
  </button>`).join('');

grid.addEventListener('click', event => {
  const button = event.target.closest('.game-card');
  if (!button) return;
  selectGame(button.dataset.gameId);
});

selectGame(GAMES[0].id);
