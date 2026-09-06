import { projectHoldemPublic } from './holdem/engine.js';
import { projectMarriagePublic } from './marriage/engine.js';
import { projectSeepState } from './seep/engine.js';
import { projectTeenPattiPublic } from './teen-patti/engine.js';
import { projectTrickState } from './trick/engine.js';

const TRICK_GAMES = new Set(['spades', 'hearts', '29', 'court-piece', 'dehla-pakad']);
const SUPPORTED_GAMES = new Set([
  'no_limit_texas_holdem', 'marriage-21', 'seep-100', 'teen_patti_classic',
  ...TRICK_GAMES,
]);
const STRING_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export const SPECTATOR_POLICY = Object.freeze({
  defaultDelayMs: 30_000,
  minimumDelayMs: 30_000,
  maximumDelayMs: 5 * 60_000,
  defaultMaxBufferedSnapshots: 256,
  maximumBufferedSnapshots: 2048,
  mode: 'public_projection_only',
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function assertId(value, name) {
  if (typeof value !== 'string' || !STRING_ID.test(value)) throw new Error(`spectator:invalid_${name}`);
}

function assertVersion(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('spectator:invalid_state_version');
}

function assertAuthoritativeState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('spectator:authoritative_state_required');
}

function assertGameBinding(gameId, state) {
  if (!SUPPORTED_GAMES.has(gameId)) throw new Error('spectator:unsupported_game');
  if (TRICK_GAMES.has(gameId)) {
    if (state.gameId !== gameId) throw new Error('spectator:authoritative_game_mismatch');
    return;
  }
  if (gameId === 'seep-100') return;
  if (state.game !== gameId) throw new Error('spectator:authoritative_game_mismatch');
}

function projectPublic(gameId, state) {
  assertGameBinding(gameId, state);
  if (gameId === 'no_limit_texas_holdem') return projectHoldemPublic(state);
  if (gameId === 'marriage-21') return projectMarriagePublic(state);
  if (gameId === 'seep-100') return projectSeepState(state, null);
  if (gameId === 'teen_patti_classic') return projectTeenPattiPublic(state);
  if (TRICK_GAMES.has(gameId)) return projectTrickState(state, null);
  throw new Error('spectator:unsupported_game');
}

function assertClockValue(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('spectator:invalid_clock');
}

export class SpectatorDelayBuffer {
  #tenantId;
  #tableId;
  #gameId;
  #delayMs;
  #maxBufferedSnapshots;
  #clock;
  #buffer = [];
  #lastStateVersion = -1;
  #lastObservedAt = -1;

  constructor({
    tenantId,
    tableId,
    gameId,
    delayMs = SPECTATOR_POLICY.defaultDelayMs,
    maxBufferedSnapshots = SPECTATOR_POLICY.defaultMaxBufferedSnapshots,
    clock = Date.now,
  }) {
    assertId(tenantId, 'tenant_id');
    assertId(tableId, 'table_id');
    assertId(gameId, 'game_id');
    if (!SUPPORTED_GAMES.has(gameId)) throw new Error('spectator:unsupported_game');
    if (!Number.isSafeInteger(delayMs) || delayMs < SPECTATOR_POLICY.minimumDelayMs || delayMs > SPECTATOR_POLICY.maximumDelayMs) {
      throw new Error('spectator:delay_outside_certified_policy');
    }
    if (!Number.isSafeInteger(maxBufferedSnapshots) || maxBufferedSnapshots < 1 || maxBufferedSnapshots > SPECTATOR_POLICY.maximumBufferedSnapshots) {
      throw new Error('spectator:invalid_buffer_limit');
    }
    if (typeof clock !== 'function') throw new Error('spectator:clock_required');
    this.#tenantId = tenantId;
    this.#tableId = tableId;
    this.#gameId = gameId;
    this.#delayMs = delayMs;
    this.#maxBufferedSnapshots = maxBufferedSnapshots;
    this.#clock = clock;
  }

  publish({ handId, stateVersion, authoritativeState }) {
    assertId(handId, 'hand_id');
    assertVersion(stateVersion);
    assertAuthoritativeState(authoritativeState);
    if (stateVersion <= this.#lastStateVersion) throw new Error('spectator:non_monotonic_state_version');
    if (this.#buffer.length >= this.#maxBufferedSnapshots) throw new Error('spectator:buffer_capacity_exceeded');

    const observedAt = this.#clock();
    assertClockValue(observedAt);
    if (observedAt < this.#lastObservedAt) throw new Error('spectator:clock_rollback');

    // Hidden state is discarded at ingest. The delay buffer never stores authoritative state.
    const projection = structuredClone(projectPublic(this.#gameId, authoritativeState));
    const snapshot = deepFreeze({
      type: 'spectator_snapshot',
      tenantId: this.#tenantId,
      tableId: this.#tableId,
      handId,
      gameId: this.#gameId,
      stateVersion,
      observedAt,
      eligibleAt: observedAt + this.#delayMs,
      projection,
    });

    this.#buffer.push(snapshot);
    this.#lastStateVersion = stateVersion;
    this.#lastObservedAt = observedAt;
    return Object.freeze({ stateVersion, eligibleAt: snapshot.eligibleAt });
  }

  readLatest() {
    const now = this.#clock();
    assertClockValue(now);
    if (now < this.#lastObservedAt) throw new Error('spectator:clock_rollback');
    let eligible = null;
    for (const snapshot of this.#buffer) {
      if (snapshot.eligibleAt <= now) eligible = snapshot;
      else break;
    }
    return eligible === null ? null : deepFreeze(structuredClone(eligible));
  }

  get bufferedCount() {
    return this.#buffer.length;
  }
}
