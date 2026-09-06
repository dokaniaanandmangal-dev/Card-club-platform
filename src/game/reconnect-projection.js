import { projectHoldemSeat } from './holdem/engine.js';
import { projectMarriageSeat } from './marriage/engine.js';
import { projectSeepState } from './seep/engine.js';
import { projectTeenPattiSeat } from './teen-patti/engine.js';
import { projectTrickState } from './trick/engine.js';

const TRICK_GAMES = new Set(['spades', 'hearts', '29', 'court-piece', 'dehla-pakad']);
const STRING_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export const SUPPORTED_RECONNECT_GAMES = Object.freeze([
  'no_limit_texas_holdem',
  'marriage-21',
  'seep-100',
  'teen_patti_classic',
  'spades',
  'hearts',
  '29',
  'court-piece',
  'dehla-pakad',
]);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function assertRecord(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`reconnect:${name}_required`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`reconnect:${name}_must_be_plain_object`);
}

function assertId(value, name) {
  if (typeof value !== 'string' || !STRING_ID.test(value)) throw new Error(`reconnect:invalid_${name}`);
}

function assertVersion(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`reconnect:invalid_${name}`);
}

function validateMemberships(memberships) {
  if (!Array.isArray(memberships) || memberships.length === 0 || memberships.length > 16) {
    throw new Error('reconnect:memberships_required');
  }
  const ids = new Set();
  return memberships.map((membership) => {
    assertRecord(membership, 'membership');
    assertId(membership.playerId, 'membership_player_id');
    assertVersion(membership.version, 'membership_version');
    if (ids.has(membership.playerId)) throw new Error('reconnect:duplicate_membership');
    ids.add(membership.playerId);
    return { playerId: membership.playerId, version: membership.version };
  });
}

function resolveIndexedSeat(state, playerId, game) {
  if (!Array.isArray(state.players)) throw new Error(`reconnect:${game}_players_missing`);
  const index = state.players.findIndex((player) => player?.id === playerId);
  if (index < 0) throw new Error('reconnect:player_not_in_authoritative_state');
  return index;
}

function resolveHoldemSeat(state, playerId) {
  if (!Array.isArray(state.players)) throw new Error('reconnect:holdem_players_missing');
  const player = state.players.find((entry) => entry?.id === playerId);
  if (!player || !Number.isSafeInteger(player.seat) || player.seat < 0) {
    throw new Error('reconnect:player_not_in_authoritative_state');
  }
  return player.seat;
}

function resolveStringPlayer(state, playerId, game) {
  if (!Array.isArray(state.players) || !state.players.includes(playerId)) {
    throw new Error(`reconnect:${game}_player_not_in_authoritative_state`);
  }
  return playerId;
}

function assertGameBinding(gameId, state) {
  if (!SUPPORTED_RECONNECT_GAMES.includes(gameId)) throw new Error('reconnect:unsupported_game');
  if (TRICK_GAMES.has(gameId)) {
    if (state.gameId !== gameId) throw new Error('reconnect:authoritative_game_mismatch');
    return;
  }
  if (gameId === 'seep-100') return;
  if (state.game !== gameId) throw new Error('reconnect:authoritative_game_mismatch');
}

function projectForPlayer(gameId, state, playerId) {
  if (gameId === 'no_limit_texas_holdem') {
    return projectHoldemSeat(state, resolveHoldemSeat(state, playerId));
  }
  if (gameId === 'marriage-21') {
    return projectMarriageSeat(state, resolveIndexedSeat(state, playerId, 'marriage'));
  }
  if (gameId === 'teen_patti_classic') {
    return projectTeenPattiSeat(state, resolveIndexedSeat(state, playerId, 'teen_patti'));
  }
  if (gameId === 'seep-100') {
    return projectSeepState(state, resolveStringPlayer(state, playerId, 'seep'));
  }
  if (TRICK_GAMES.has(gameId)) {
    return projectTrickState(state, resolveStringPlayer(state, playerId, 'trick'));
  }
  throw new Error('reconnect:unsupported_game');
}

/**
 * Rebuild a reconnect payload from the current authoritative state.
 *
 * Security properties:
 * - the viewer identity comes only from authenticatedSession.playerId;
 * - tenant/table scope must match the authoritative tableContext exactly;
 * - membership versions invalidate stale sessions after leave/reseat events;
 * - caller-supplied seat/viewer selectors are deliberately unsupported;
 * - the authoritative state itself is never copied into the reconnect payload.
 */
export function buildReconnectProjection({ gameId, authoritativeState, authenticatedSession, tableContext }) {
  assertId(gameId, 'game_id');
  assertRecord(authoritativeState, 'authoritative_state');
  assertRecord(authenticatedSession, 'authenticated_session');
  assertRecord(tableContext, 'table_context');

  assertId(authenticatedSession.subject, 'subject');
  assertId(authenticatedSession.tenantId, 'session_tenant_id');
  assertId(authenticatedSession.tableId, 'session_table_id');
  assertId(authenticatedSession.playerId, 'session_player_id');
  assertVersion(authenticatedSession.membershipVersion, 'session_membership_version');

  assertId(tableContext.tenantId, 'table_tenant_id');
  assertId(tableContext.tableId, 'table_id');
  assertId(tableContext.handId, 'hand_id');
  assertVersion(tableContext.stateVersion, 'state_version');
  const memberships = validateMemberships(tableContext.memberships);

  if (authenticatedSession.tenantId !== tableContext.tenantId) throw new Error('reconnect:tenant_mismatch');
  if (authenticatedSession.tableId !== tableContext.tableId) throw new Error('reconnect:table_mismatch');

  const membership = memberships.find((entry) => entry.playerId === authenticatedSession.playerId);
  if (!membership) throw new Error('reconnect:membership_missing');
  if (membership.version !== authenticatedSession.membershipVersion) throw new Error('reconnect:stale_membership');

  assertGameBinding(gameId, authoritativeState);
  const projection = structuredClone(projectForPlayer(gameId, authoritativeState, authenticatedSession.playerId));

  return deepFreeze({
    type: 'game_resume',
    tenantId: tableContext.tenantId,
    tableId: tableContext.tableId,
    handId: tableContext.handId,
    gameId,
    stateVersion: tableContext.stateVersion,
    playerId: authenticatedSession.playerId,
    projection,
  });
}
