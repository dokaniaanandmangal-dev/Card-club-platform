import { createHash } from 'node:crypto';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const DIGEST_RE = /^[a-f0-9]{64}$/;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const LIMITS = Object.freeze({
  maxDepth: 12,
  maxObjectKeys: 256,
  maxArrayLength: 256,
  maxStringLength: 8192,
  maxSeats: 64,
});

function validateId(value, field) {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new Error(`${field}:invalid_identifier`);
  return value;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalize(value, field = 'state', depth = 0, seen = new WeakSet()) {
  if (depth > LIMITS.maxDepth) throw new Error(`${field}:too_deep`);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`${field}:unsafe_number`);
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > LIMITS.maxStringLength) throw new Error(`${field}:string_too_long`);
    return value;
  }
  if (typeof value !== 'object') throw new Error(`${field}:unsupported_value`);
  if (seen.has(value)) throw new Error(`${field}:cyclic`);
  seen.add(value);

  if (Array.isArray(value)) {
    if (value.length > LIMITS.maxArrayLength) throw new Error(`${field}:array_too_large`);
    const result = value.map((entry, index) => normalize(entry, `${field}[${index}]`, depth + 1, seen));
    seen.delete(value);
    return result;
  }

  if (!isPlainObject(value)) throw new Error(`${field}:non_plain_object`);
  const keys = Object.keys(value).sort();
  if (keys.length > LIMITS.maxObjectKeys) throw new Error(`${field}:object_too_large`);
  const result = Object.create(null);
  for (const key of keys) {
    if (DANGEROUS_KEYS.has(key)) throw new Error(`${field}:dangerous_key`);
    result[key] = normalize(value[key], `${field}.${key}`, depth + 1, seen);
  }
  seen.delete(value);
  return result;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(value);
}

function digestCanonical(value) {
  return createHash('sha256')
    .update('card-club/game-outcome/v1\n', 'utf8')
    .update(canonicalJson(value), 'utf8')
    .digest('hex');
}

function validateSequence(sequence, previousOutcomeDigest) {
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('sequence:invalid');
  if (sequence === 0) {
    if (previousOutcomeDigest !== null) throw new Error('previousOutcomeDigest:must_be_null_for_genesis');
  } else if (typeof previousOutcomeDigest !== 'string' || !DIGEST_RE.test(previousOutcomeDigest)) {
    throw new Error('previousOutcomeDigest:invalid');
  }
}

export function createAuthoritativeOutcome(input) {
  if (!isPlainObject(input)) throw new Error('outcome:invalid_input');
  const tenantId = validateId(input.tenantId, 'tenantId');
  const tableId = validateId(input.tableId, 'tableId');
  const handId = validateId(input.handId, 'handId');
  if (!Number.isSafeInteger(input.epoch) || input.epoch < 0) throw new Error('epoch:invalid');
  validateSequence(input.sequence, input.previousOutcomeDigest);
  if (!Array.isArray(input.seats) || input.seats.length < 2 || input.seats.length > LIMITS.maxSeats) {
    throw new Error('seats:invalid_count');
  }

  const seatIds = new Set();
  const playerIds = new Set();
  const seats = input.seats.map((seat, index) => {
    if (!isPlainObject(seat)) throw new Error(`seat_${index}:invalid`);
    const seatId = validateId(seat.seatId, `seat_${index}.seatId`);
    const playerId = validateId(seat.playerId, `seat_${index}.playerId`);
    if (seatIds.has(seatId)) throw new Error('seats:duplicate_seat');
    if (playerIds.has(playerId)) throw new Error('seats:duplicate_player');
    seatIds.add(seatId);
    playerIds.add(playerId);
    return {
      seatId,
      playerId,
      publicState: normalize(seat.publicState ?? {}, `seat_${index}.publicState`),
      privateState: normalize(seat.privateState ?? {}, `seat_${index}.privateState`),
    };
  }).sort((left, right) => left.seatId.localeCompare(right.seatId));

  const canonical = {
    version: 1,
    tenantId,
    tableId,
    handId,
    epoch: input.epoch,
    sequence: input.sequence,
    previousOutcomeDigest: input.previousOutcomeDigest,
    publicState: normalize(input.publicState ?? {}, 'publicState'),
    seats,
  };
  const outcomeDigest = digestCanonical(canonical);
  return deepFreeze({ ...canonical, outcomeDigest });
}

function publicCore(authoritative) {
  if (!authoritative || typeof authoritative !== 'object' || !DIGEST_RE.test(authoritative.outcomeDigest ?? '')) {
    throw new Error('outcome:not_authoritative');
  }
  return {
    version: authoritative.version,
    tenantId: authoritative.tenantId,
    tableId: authoritative.tableId,
    handId: authoritative.handId,
    epoch: authoritative.epoch,
    sequence: authoritative.sequence,
    previousOutcomeDigest: authoritative.previousOutcomeDigest,
    outcomeDigest: authoritative.outcomeDigest,
    publicState: normalize(authoritative.publicState, 'projection.publicState'),
    seats: authoritative.seats.map(seat => ({
      seatId: seat.seatId,
      playerId: seat.playerId,
      publicState: normalize(seat.publicState, `projection.${seat.seatId}.publicState`),
    })),
  };
}

export function projectPublicOutcome(authoritative) {
  return deepFreeze(publicCore(authoritative));
}

export function projectSeatOutcome(authoritative, viewerSeatId) {
  validateId(viewerSeatId, 'viewerSeatId');
  const seat = authoritative?.seats?.find(candidate => candidate.seatId === viewerSeatId);
  if (!seat) throw new Error('viewerSeatId:not_found');
  return deepFreeze({
    ...publicCore(authoritative),
    viewer: {
      seatId: seat.seatId,
      playerId: seat.playerId,
      privateState: normalize(seat.privateState, 'projection.viewer.privateState'),
    },
  });
}

export function verifyOutcomeChain(previousOutcome, nextOutcome) {
  if (!previousOutcome || !nextOutcome) throw new Error('outcome_chain:missing');
  if (previousOutcome.tenantId !== nextOutcome.tenantId || previousOutcome.tableId !== nextOutcome.tableId) {
    throw new Error('outcome_chain:boundary_mismatch');
  }
  if (nextOutcome.sequence !== previousOutcome.sequence + 1) throw new Error('outcome_chain:sequence_gap');
  if (nextOutcome.previousOutcomeDigest !== previousOutcome.outcomeDigest) throw new Error('outcome_chain:digest_mismatch');
  return true;
}

export const GAME_OUTCOME_LIMITS = LIMITS;
