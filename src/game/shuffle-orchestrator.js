import { createHash } from 'node:crypto';

import {
  buildShuffleManifest,
  finalizeCommittedShuffle,
  verifyShuffleDisclosure,
} from './fair-shuffle.js';

const SESSIONS = new WeakSet();
const ISSUED_DECKS = new WeakSet();
const ROUTED_DECKS = new WeakSet();
const HEX_32 = /^[0-9a-f]{64}$/;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function hashFields(domain, fields) {
  const hash = createHash('sha256');
  hash.update(domain, 'utf8');
  for (const field of fields) {
    const bytes = Buffer.isBuffer(field) ? field : Buffer.from(String(field), 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    hash.update(length);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

function cloneCanonicalDeck(deck) {
  if (!Array.isArray(deck) || deck.length < 2 || deck.length > 512) {
    throw new Error('shuffle_orchestrator:invalid_canonical_deck');
  }
  const ids = new Set();
  const cloned = deck.map((card) => {
    if (!card || typeof card !== 'object' || typeof card.id !== 'string' || card.id.length < 1 || card.id.length > 64) {
      throw new Error('shuffle_orchestrator:invalid_canonical_card');
    }
    if (ids.has(card.id)) throw new Error(`shuffle_orchestrator:duplicate_card:${card.id}`);
    ids.add(card.id);
    return structuredClone(card);
  });
  return deepFreeze(cloned);
}

function canonicalDeckDigest(deck) {
  return hashFields('card-club/shuffle/canonical-deck/v1', deck.map((card) => card.id));
}

function disclosureDigest(disclosure) {
  const participantSeeds = [...disclosure.participantSeeds]
    .map((entry) => ({ id: entry.id, seed: entry.seed }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const fields = [
    disclosure.manifestDigest,
    disclosure.deckDigest,
    disclosure.serverSeed,
  ];
  for (const entry of participantSeeds) fields.push(entry.id, entry.seed);
  for (const cardId of disclosure.orderedCardIds) fields.push(cardId);
  return hashFields('card-club/shuffle/disclosure/v1', fields);
}

function assertPersistence(persistence) {
  if (!persistence || typeof persistence !== 'object') throw new Error('shuffle_orchestrator:persistence_required');
  for (const name of ['recordManifest', 'recordDeckIssued', 'recordAbort', 'recordDisclosure']) {
    if (typeof persistence[name] !== 'function') throw new Error(`shuffle_orchestrator:persistence_missing_${name}`);
  }
  return persistence;
}

function assertSession(session) {
  if (!session || typeof session !== 'object' || !SESSIONS.has(session)) {
    throw new Error('shuffle_orchestrator:invalid_session');
  }
  return session;
}

function assertPersistStatus(result, allowed, label) {
  if (!result || typeof result !== 'object' || !allowed.includes(result.status)) {
    throw new Error(`shuffle_orchestrator:${label}_not_persisted`);
  }
  return result;
}

function assertReasonCode(reasonCode) {
  if (typeof reasonCode !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(reasonCode)) {
    throw new Error('shuffle_orchestrator:invalid_abort_reason');
  }
  return reasonCode;
}

function auditContext(manifest) {
  return Object.freeze({
    tenantId: manifest.context.tenantId,
    tableId: manifest.context.tableId,
    handId: manifest.context.handId,
    gameId: manifest.context.gameId,
    manifestDigest: manifest.manifestDigest,
  });
}

export async function beginAuditedShuffle({
  canonicalDeck,
  context,
  serverCommitment,
  participants,
  persistence,
} = {}) {
  const store = assertPersistence(persistence);
  const deck = cloneCanonicalDeck(canonicalDeck);
  const manifest = buildShuffleManifest({ context, serverCommitment, participants });
  const deckDigest = canonicalDeckDigest(deck);

  const persisted = await store.recordManifest({
    ...auditContext(manifest),
    serverCommitment: manifest.serverCommitment,
    participants: manifest.participants,
    canonicalDeckDigest: deckDigest,
    deckSize: deck.length,
  });
  assertPersistStatus(persisted, ['recorded', 'replay'], 'manifest');

  const session = Object.freeze({
    manifest,
    canonicalDeck: deck,
    canonicalDeckDigest: deckDigest,
    persistence: store,
  });
  SESSIONS.add(session);
  return session;
}

export async function issueAuditedDeck(session, { serverSeed, participantSeeds } = {}) {
  const active = assertSession(session);
  const finalized = finalizeCommittedShuffle({
    canonicalDeck: active.canonicalDeck,
    manifest: active.manifest,
    serverSeed,
    participantSeeds,
  });

  const persisted = await active.persistence.recordDeckIssued({
    ...auditContext(active.manifest),
    deckDigest: finalized.publicReceipt.deckDigest,
  });
  assertPersistStatus(persisted, ['issued', 'replay'], 'deck');

  const issued = Object.freeze({
    deck: deepFreeze(structuredClone(finalized.deck)),
    publicReceipt: finalized.publicReceipt,
    disclosure: finalized.disclosure,
    auditReceipt: Object.freeze({
      ...auditContext(active.manifest),
      canonicalDeckDigest: active.canonicalDeckDigest,
      deckDigest: finalized.publicReceipt.deckDigest,
      status: 'issued',
    }),
  });
  ISSUED_DECKS.add(issued);
  return issued;
}

export async function abortAuditedShuffle(session, { reasonCode } = {}) {
  const active = assertSession(session);
  const reason = assertReasonCode(reasonCode);
  const persisted = await active.persistence.recordAbort({
    ...auditContext(active.manifest),
    reasonCode: reason,
  });
  assertPersistStatus(persisted, ['aborted', 'replay'], 'abort');
  return Object.freeze({ ...auditContext(active.manifest), status: 'aborted', reasonCode: reason });
}

export async function recordShuffleDisclosure(session, disclosure) {
  const active = assertSession(session);
  const verified = verifyShuffleDisclosure(active.canonicalDeck, disclosure);
  if (verified.manifestDigest !== active.manifest.manifestDigest) {
    throw new Error('shuffle_orchestrator:disclosure_manifest_mismatch');
  }
  if (typeof verified.deckDigest !== 'string' || !HEX_32.test(verified.deckDigest)) {
    throw new Error('shuffle_orchestrator:invalid_disclosure_deck_digest');
  }
  const detailDigest = disclosureDigest(disclosure);
  const persisted = await active.persistence.recordDisclosure({
    ...auditContext(active.manifest),
    deckDigest: verified.deckDigest,
    disclosureDigest: detailDigest,
  });
  assertPersistStatus(persisted, ['disclosed', 'replay'], 'disclosure');
  return Object.freeze({
    ...auditContext(active.manifest),
    deckDigest: verified.deckDigest,
    disclosureDigest: detailDigest,
    status: 'disclosed',
  });
}

export function routeAuditedDeck(issuedDeck, consumer) {
  if (!issuedDeck || typeof issuedDeck !== 'object' || !ISSUED_DECKS.has(issuedDeck)) {
    throw new Error('shuffle_orchestrator:unaudited_deck_rejected');
  }
  if (typeof consumer !== 'function') throw new Error('shuffle_orchestrator:consumer_required');
  if (ROUTED_DECKS.has(issuedDeck)) throw new Error('shuffle_orchestrator:deck_already_routed');

  // Single-use fail-closed routing prevents one audited deck from forking into
  // multiple game branches. The deck is burned before invoking the consumer;
  // if the consumer fails, the hand must be restarted with a new audited deck.
  ROUTED_DECKS.add(issuedDeck);
  return consumer(deepFreeze(structuredClone(issuedDeck.deck)), issuedDeck.auditReceipt, issuedDeck.publicReceipt);
}

export function isAuditedDeck(issuedDeck) {
  return Boolean(issuedDeck && typeof issuedDeck === 'object' && ISSUED_DECKS.has(issuedDeck));
}

export function isRoutedAuditedDeck(issuedDeck) {
  return Boolean(issuedDeck && typeof issuedDeck === 'object' && ROUTED_DECKS.has(issuedDeck));
}
