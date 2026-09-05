import { verifyDualSettlement } from './settlement-controller.js';

const FENCE_RE = /^[1-9][0-9]{0,18}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const PG_BIGINT_MAX = 9223372036854775807n;

function validateFenceToken(value) {
  if (typeof value !== 'string' || !FENCE_RE.test(value)) throw new Error('financial_integrity:invalid_fence_token');
  if (BigInt(value) > PG_BIGINT_MAX) throw new Error('financial_integrity:invalid_fence_token');
  return value;
}

function freezeAllocations(rows) {
  return Object.freeze(rows.map(row => Object.freeze({ ...row })));
}

async function emitBlock(onIntegrityEvent, input, error) {
  if (!onIntegrityEvent) return;
  await onIntegrityEvent(Object.freeze({
    type: 'financial_integrity_block',
    reason: error instanceof Error ? error.message : 'unknown_verification_failure',
    tenantId: typeof input?.tenantId === 'string' ? input.tenantId : null,
    tableId: typeof input?.tableId === 'string' ? input.tableId : null,
    handId: typeof input?.handId === 'string' ? input.handId : null,
  }));
}

async function bindPersistedOutcome(input, loadOutcome) {
  if (typeof loadOutcome !== 'function') throw new Error('financial_integrity:outcome_loader_required');
  if (Object.prototype.hasOwnProperty.call(input ?? {}, 'outcomeDigest')) {
    throw new Error('financial_integrity:free_form_outcome_digest_forbidden');
  }
  const persisted = await loadOutcome(Object.freeze({
    tenantId: input?.tenantId,
    tableId: input?.tableId,
    handId: input?.handId,
    epoch: input?.epoch,
  }));
  if (!persisted || typeof persisted !== 'object') throw new Error('financial_integrity:outcome_not_persisted');
  if (
    persisted.tenantId !== input?.tenantId
    || persisted.tableId !== input?.tableId
    || persisted.handId !== input?.handId
    || persisted.epoch !== input?.epoch
    || !SHA256_RE.test(persisted.outcomeDigest ?? '')
  ) {
    throw new Error('financial_integrity:outcome_boundary_mismatch');
  }
  return persisted.outcomeDigest;
}

export async function executeFinancialIntegritySettlement(input, {
  commit,
  loadOutcome,
  fenceToken,
  primary,
  shadow,
  onIntegrityEvent,
} = {}) {
  if (typeof commit !== 'function') throw new Error('financial_integrity:commit_adapter_required');
  if (onIntegrityEvent !== undefined && typeof onIntegrityEvent !== 'function') {
    throw new Error('financial_integrity:invalid_event_sink');
  }
  const validatedFence = validateFenceToken(fenceToken);
  const verifierOptions = {};
  if (primary !== undefined) verifierOptions.primary = primary;
  if (shadow !== undefined) verifierOptions.shadow = shadow;

  let verified;
  try {
    // The financial path never trusts a caller-supplied outcome digest. It first
    // resolves the exact tenant/table/hand/epoch commitment persisted by Game Core.
    const outcomeDigest = await bindPersistedOutcome(input, loadOutcome);
    const boundInput = Object.freeze({ ...input, outcomeDigest });

    // No financial persistence callback is reachable until both independent
    // settlement implementations agree on the exact persisted outcome-bound result.
    verified = verifyDualSettlement(boundInput, verifierOptions);
  } catch (error) {
    await emitBlock(onIntegrityEvent, input, error);
    throw error;
  }

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
