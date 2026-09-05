import { computePrimarySettlement } from './settlement-primary.js';
import { computeShadowSettlement } from './settlement-shadow.js';

function identicalAllocations(left, right) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i].accountId !== right[i].accountId || left[i].deltaMinor !== right[i].deltaMinor) return false;
  }
  return true;
}

export function verifyDualSettlement(input, {
  primary = computePrimarySettlement,
  shadow = computeShadowSettlement,
} = {}) {
  const primaryResult = primary(input);
  const shadowResult = shadow(input);

  if (
    primaryResult.tenantId !== shadowResult.tenantId
    || primaryResult.tableId !== shadowResult.tableId
    || primaryResult.handId !== shadowResult.handId
    || primaryResult.epoch !== shadowResult.epoch
    || primaryResult.digest !== shadowResult.digest
    || !identicalAllocations(primaryResult.allocations, shadowResult.allocations)
  ) {
    throw new Error('settlement:shadow_mismatch');
  }

  return Object.freeze({ ...primaryResult, verifiedByShadow: true });
}
