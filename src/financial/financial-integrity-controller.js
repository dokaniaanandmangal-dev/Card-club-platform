import { verifyDualSettlement } from './settlement-controller.js';

const FENCE_RE = /^[1-9][0-9]{0,18}$/;
const PG_BIGINT_MAX = 9223372036854775807n;

function validateFenceToken(value) {
  if (typeof value !== 'string' || !FENCE_RE.test(value)) throw new Error('financial_integrity:invalid_fence_token');
  if (BigInt(value) > PG_BIGINT_MAX) throw new Error('financial_integrity:invalid_fence_token');
  return value;
}

function freezeAllocations(rows) {
  return Object.freeze(rows.map(row => Object.freeze({ ...row })));
}

export async function executeFinancialIntegritySettlement(input, {
  commit,
  fenceToken,
  primary,
  shadow,
} = {}) {
  if (typeof commit !== 'function') throw new Error('financial_integrity:commit_adapter_required');
  const validatedFence = validateFenceToken(fenceToken);
  const verifierOptions = {};
  if (primary !== undefined) verifierOptions.primary = primary;
  if (shadow !== undefined) verifierOptions.shadow = shadow;

  // No persistence callback is reachable until both independent settlement
  // implementations have agreed on the exact outcome-bound economic result.
  const verified = verifyDualSettlement(input, verifierOptions);
  const command = Object.freeze({
    tenantId: verified.tenantId,
    tableId: verified.tableId,
    handId: verified.handId,
    epoch: verified.epoch,
    outcomeDigest: verified.outcomeDigest,
    settlementDigest: verified.digest,
    allocations: freezeAllocations(verified.allocations),
    verificationScheme: verified.verificationScheme,
    fenceToken: validatedFence,
  });

  return commit(command);
}
