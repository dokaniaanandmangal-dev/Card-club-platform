import { buildReconnectProjection } from './reconnect-projection.js';
import { SpectatorDelayBuffer } from './spectator-delay.js';

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function assertId(value, name) {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error(`table_router:invalid_${name}`);
}

function assertVersion(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('table_router:invalid_state_version');
}

function assertState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('table_router:authoritative_state_required');
}

function tableKey(tenantId, tableId) {
  return `${tenantId}\u0000${tableId}`;
}

/**
 * Server-internal scope boundary for live table projections.
 *
 * A table's tenant/table identity is captured once by openTable(). Subsequent
 * authoritative publications through that handle cannot provide or override a
 * routing scope. Reconnect consumers likewise cannot name a target table: the
 * authenticated session is the sole lookup authority.
 */
export class TableProjectionRouter {
  #tables = new Map();
  #clock;
  #spectatorDelayMs;
  #maxTables;

  constructor({ clock = Date.now, spectatorDelayMs = 30_000, maxTables = 4096 } = {}) {
    if (typeof clock !== 'function') throw new Error('table_router:clock_required');
    if (!Number.isSafeInteger(maxTables) || maxTables < 1 || maxTables > 65_536) throw new Error('table_router:invalid_table_limit');
    this.#clock = clock;
    this.#spectatorDelayMs = spectatorDelayMs;
    this.#maxTables = maxTables;
  }

  openTable({ tenantId, tableId }) {
    assertId(tenantId, 'tenant_id');
    assertId(tableId, 'table_id');
    const key = tableKey(tenantId, tableId);
    if (this.#tables.has(key)) throw new Error('table_router:table_already_open');
    if (this.#tables.size >= this.#maxTables) throw new Error('table_router:table_capacity_exceeded');

    const record = {
      tenantId,
      tableId,
      gameId: null,
      handId: null,
      stateVersion: -1,
      memberships: null,
      authoritativeState: null,
      spectator: null,
    };
    this.#tables.set(key, record);

    const publish = ({ gameId, handId, stateVersion, memberships, authoritativeState }) => {
      assertId(gameId, 'game_id');
      assertId(handId, 'hand_id');
      assertVersion(stateVersion);
      assertState(authoritativeState);
      if (!Array.isArray(memberships) || memberships.length === 0) throw new Error('table_router:memberships_required');
      if (stateVersion <= record.stateVersion) throw new Error('table_router:non_monotonic_state_version');

      // Clone at the authoritative publication boundary so later mutations by
      // the producer cannot alter reconnect or spectator output.
      const stateCopy = deepFreeze(structuredClone(authoritativeState));
      const membershipCopy = deepFreeze(structuredClone(memberships));
      const gameChanged = record.gameId !== null && record.gameId !== gameId;

      record.gameId = gameId;
      record.handId = handId;
      record.stateVersion = stateVersion;
      record.memberships = membershipCopy;
      record.authoritativeState = stateCopy;
      if (gameChanged) record.spectator = null;

      return deepFreeze({ tenantId, tableId, gameId, handId, stateVersion });
    };

    return deepFreeze({ tenantId, tableId, publish });
  }

  #requireRecord(tenantId, tableId) {
    assertId(tenantId, 'tenant_id');
    assertId(tableId, 'table_id');
    const record = this.#tables.get(tableKey(tenantId, tableId));
    if (!record) throw new Error('table_router:table_not_found');
    if (record.authoritativeState === null) throw new Error('table_router:table_state_unavailable');
    return record;
  }

  buildReconnect({ authenticatedSession }) {
    if (!authenticatedSession || typeof authenticatedSession !== 'object' || Array.isArray(authenticatedSession)) {
      throw new Error('table_router:authenticated_session_required');
    }
    // There is intentionally no target tenant/table parameter. The verified
    // session scope is the only table lookup authority.
    const record = this.#requireRecord(authenticatedSession.tenantId, authenticatedSession.tableId);
    return buildReconnectProjection({
      gameId: record.gameId,
      authoritativeState: record.authoritativeState,
      authenticatedSession,
      tableContext: {
        tenantId: record.tenantId,
        tableId: record.tableId,
        handId: record.handId,
        stateVersion: record.stateVersion,
        memberships: record.memberships,
      },
    });
  }

  captureSpectator({ tenantId, tableId }) {
    const record = this.#requireRecord(tenantId, tableId);
    if (record.spectator === null) {
      record.spectator = new SpectatorDelayBuffer({
        tenantId: record.tenantId,
        tableId: record.tableId,
        gameId: record.gameId,
        delayMs: this.#spectatorDelayMs,
        clock: this.#clock,
      });
    }
    return record.spectator.publish({
      handId: record.handId,
      stateVersion: record.stateVersion,
      authoritativeState: record.authoritativeState,
    });
  }

  readSpectator({ tenantId, tableId }) {
    const record = this.#requireRecord(tenantId, tableId);
    return record.spectator?.readLatest() ?? null;
  }

  closeTable({ tenantId, tableId }) {
    assertId(tenantId, 'tenant_id');
    assertId(tableId, 'table_id');
    return this.#tables.delete(tableKey(tenantId, tableId));
  }

  get openTableCount() {
    return this.#tables.size;
  }
}
