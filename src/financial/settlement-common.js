import { createHash } from 'node:crypto';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export function validateIdentity(value, field) {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new Error(`${field}:invalid_identifier`);
  return value;
}

export function validateEpoch(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('epoch:invalid');
  return value;
}

export function settlementDigest({ tenantId, tableId, handId, epoch, allocations }) {
  const canonical = JSON.stringify({
    version: 1,
    unit: 'chip-minor',
    tenantId,
    tableId,
    handId,
    epoch,
    allocations,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
