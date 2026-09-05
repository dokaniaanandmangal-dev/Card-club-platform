import { createHash } from 'node:crypto';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export function validateIdentity(value, field) {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new Error(`${field}:invalid_identifier`);
  return value;
}

export function validateEpoch(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('epoch:invalid');
  return value;
}

export function validateSha256Digest(value, field = 'digest') {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) throw new Error(`${field}:invalid_sha256`);
  return value;
}

export function settlementDigest({ tenantId, tableId, handId, epoch, outcomeDigest, allocations }) {
  const canonical = JSON.stringify({
    version: 2,
    unit: 'chip-minor',
    tenantId,
    tableId,
    handId,
    epoch,
    outcomeDigest,
    allocations,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
