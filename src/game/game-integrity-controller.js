import { executeFinancialIntegritySettlement } from '../financial/financial-integrity-controller.js';
import { createAuthoritativeOutcome } from './outcome.js';
import { isAuditedDeck, isRoutedAuditedDeck, routeAuditedDeck } from './shuffle-orchestrator.js';

const HANDS = new WeakMap();
const HEX_32 = /^[0-9a-f]{64}$/;
const RESERVED_PUBLIC_KEY = 'gameIntegrity';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function assertPlain(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`game_integrity:${name}_required`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new Error(`game_integrity:${name}_must_be_plain_object`);
}

function assertOutcomePersistence(persistence) {
  if (!persistence || typeof persistence !== 'object') throw new Error('game_integrity:outcome_persistence_required');
  if (typeof persistence.record !== 'function') throw new Error('game_integrity:outcome_record_required');
  if (typeof persistence.loadForSettlement !== 'function') throw new Error('game_integrity:outcome_loader_required');
  return persistence;
}

function assertAuditReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || receipt.status !== 'issued') throw new Error('game_integrity:issued_audit_receipt_required');
  for (const field of ['manifestDigest', 'canonicalDeckDigest', 'deckDigest']) {
    if (!HEX_32.test(receipt[field] ?? '')) throw new Error(`game_integrity:invalid_${field}`);
  }
  return receipt;
}

function assertScopeMatchesAudit(outcomeInput, receipt) {
  if (
    outcomeInput.tenantId !== receipt.tenantId
    || outcomeInput.tableId !== receipt.tableId
    || outcomeInput.handId !== receipt.handId
  ) {
    throw new Error('game_integrity:shuffle_outcome_scope_mismatch');
  }
}

function buildBoundOutcome(outcomeInput, receipt) {
  assertPlain(outcomeInput, 'outcome');
  if (Object.prototype.hasOwnProperty.call(outcomeInput, 'outcomeDigest')) {
    throw new Error('game_integrity:caller_outcome_digest_forbidden');
  }
  const publicState = outcomeInput.publicState ?? {};
  assertPlain(publicState, 'public_state');
  if (Object.prototype.hasOwnProperty.call(publicState, RESERVED_PUBLIC_KEY)) {
    throw new Error('game_integrity:reserved_public_integrity_key');
  }
  assertScopeMatchesAudit(outcomeInput, receipt);

  return createAuthoritativeOutcome({
    ...outcomeInput,
    publicState: {
      ...structuredClone(publicState),
      [RESERVED_PUBLIC_KEY]: {
        scheme: 'game-integrity-v1',
        gameId: receipt.gameId,
        shuffleManifestDigest: receipt.manifestDigest,
        canonicalDeckDigest: receipt.canonicalDeckDigest,
        shuffledDeckDigest: receipt.deckDigest,
        routing: 'single-use-audited-deck',
      },
    },
  });
}

function assertSettlementInput(settlement) {
  assertPlain(settlement, 'settlement');
  for (const forbidden of ['tenantId', 'tableId', 'handId', 'epoch', 'outcomeDigest']) {
    if (Object.prototype.hasOwnProperty.call(settlement, forbidden)) {
      throw new Error(`game_integrity:settlement_${forbidden}_forbidden`);
    }
  }
  if (!Array.isArray(settlement.participants)) throw new Error('game_integrity:settlement_participants_required');
  return settlement;
}

function assertPersistedOutcome(receipt, authoritative) {
  if (!receipt || typeof receipt !== 'object' || !['recorded', 'replay'].includes(receipt.status)) {
    throw new Error('game_integrity:outcome_not_persisted');
  }
  if (receipt.outcomeDigest !== authoritative.outcomeDigest) throw new Error('game_integrity:persisted_outcome_digest_mismatch');
}

/**
 * Routes one audited deck exactly once into a game consumer and returns a
 * controller-issued hand token. A consumer failure burns the deck and yields no
 * token, preventing a second branch from being created from the same shuffle.
 */
export function routeGameIntegrityDeck(issuedDeck, consumer) {
  if (!isAuditedDeck(issuedDeck)) throw new Error('game_integrity:audited_deck_required');
  if (typeof consumer !== 'function') throw new Error('game_integrity:game_consumer_required');

  const consumerResult = routeAuditedDeck(issuedDeck, consumer);
  if (!isRoutedAuditedDeck(issuedDeck)) throw new Error('game_integrity:deck_route_attestation_missing');

  const handToken = deepFreeze({});
  HANDS.set(handToken, issuedDeck);
  return deepFreeze({ handToken, consumerResult });
}

/**
 * Final certification boundary:
 * routed audited deck -> shuffle-bound authoritative outcome -> durable outcome
 * -> dual independent financial verification -> fenced atomic settlement commit.
 */
export async function finalizeGameIntegrityHand({ handToken, outcome, settlement } = {}, {
  outcomePersistence,
  commit,
  fenceToken,
  primary,
  shadow,
  onIntegrityEvent,
} = {}) {
  if (!handToken || typeof handToken !== 'object' || !HANDS.has(handToken)) {
    throw new Error('game_integrity:invalid_hand_token');
  }
  if (typeof commit !== 'function') throw new Error('game_integrity:settlement_commit_required');
  const persistence = assertOutcomePersistence(outcomePersistence);
  const issuedDeck = HANDS.get(handToken);
  if (!isAuditedDeck(issuedDeck) || !isRoutedAuditedDeck(issuedDeck)) throw new Error('game_integrity:routed_audited_deck_required');
  const auditReceipt = assertAuditReceipt(issuedDeck.auditReceipt);
  const settlementInput = assertSettlementInput(settlement);
  const authoritative = buildBoundOutcome(outcome, auditReceipt);

  // Financial persistence is unreachable until the exact shuffle-bound outcome
  // has been durably recorded. Changed retries are rejected by outcome storage.
  const recorded = await persistence.record(authoritative);
  assertPersistedOutcome(recorded, authoritative);

  const financialInput = Object.freeze({
    tenantId: authoritative.tenantId,
    tableId: authoritative.tableId,
    handId: authoritative.handId,
    epoch: authoritative.epoch,
    participants: structuredClone(settlementInput.participants),
  });
  const options = {
    commit,
    loadOutcome: persistence.loadForSettlement,
    fenceToken,
  };
  if (primary !== undefined) options.primary = primary;
  if (shadow !== undefined) options.shadow = shadow;
  if (onIntegrityEvent !== undefined) options.onIntegrityEvent = onIntegrityEvent;

  const financialReceipt = await executeFinancialIntegritySettlement(financialInput, options);
  return deepFreeze({
    status: 'settled',
    tenantId: authoritative.tenantId,
    tableId: authoritative.tableId,
    handId: authoritative.handId,
    epoch: authoritative.epoch,
    gameId: auditReceipt.gameId,
    shuffleManifestDigest: auditReceipt.manifestDigest,
    shuffledDeckDigest: auditReceipt.deckDigest,
    outcomeDigest: authoritative.outcomeDigest,
    outcomePersistenceStatus: recorded.status,
    financialReceipt: structuredClone(financialReceipt),
  });
}
