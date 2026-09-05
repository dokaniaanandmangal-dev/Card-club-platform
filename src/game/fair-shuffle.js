import { createHash, createHmac, randomBytes } from 'node:crypto';

const HEX_32 = /^[0-9a-f]{64}$/;
const ALGORITHM = 'HMAC-SHA256-Fisher-Yates-v1';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function assertId(value, label) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function assertDigest(value, label) {
  if (typeof value !== 'string' || !HEX_32.test(value)) throw new Error(`invalid ${label}`);
  return value;
}

function normalizeContext(context) {
  if (!context || typeof context !== 'object') throw new Error('shuffle context required');
  return Object.freeze({
    tenantId: assertId(context.tenantId, 'shuffle tenantId'),
    tableId: assertId(context.tableId, 'shuffle tableId'),
    handId: assertId(context.handId, 'shuffle handId'),
    gameId: assertId(context.gameId, 'shuffle gameId'),
  });
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

function validateSeed(seed, label = 'shuffle seed') {
  if (typeof seed !== 'string' || !HEX_32.test(seed)) throw new Error(`${label} must be 32-byte lowercase hex`);
  return seed;
}

function manifestCore({ context, serverCommitment, participants }) {
  const normalized = normalizeContext(context);
  assertDigest(serverCommitment, 'server shuffle commitment');
  if (!Array.isArray(participants) || participants.length < 1 || participants.length > 32) throw new Error('shuffle participants required');
  const ids = new Set();
  const normalizedParticipants = participants.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('invalid shuffle participant');
    const id = assertId(entry.id, 'shuffle participant id');
    if (ids.has(id)) throw new Error('duplicate shuffle participant');
    ids.add(id);
    return { id, commitment: assertDigest(entry.commitment, 'participant shuffle commitment') };
  }).sort((a, b) => a.id.localeCompare(b.id));
  return { version: 1, context: normalized, serverCommitment, participants: normalizedParticipants };
}

function computeManifestDigest(core) {
  return hashFields('card-club/shuffle/manifest/v1', [JSON.stringify(core)]);
}

function validateCanonicalDeck(deck) {
  if (!Array.isArray(deck) || deck.length < 2 || deck.length > 512) throw new Error('canonical deck must contain 2-512 cards');
  const ids = new Set();
  return deck.map((card) => {
    if (!card || typeof card !== 'object' || typeof card.id !== 'string' || card.id.length < 1 || card.id.length > 64) throw new Error('canonical deck card requires id');
    if (ids.has(card.id)) throw new Error(`duplicate canonical deck id ${card.id}`);
    ids.add(card.id);
    return structuredClone(card);
  });
}

function createDeterministicRng(seedHex, contextDigest) {
  const key = Buffer.from(seedHex, 'hex');
  let counter = 0n;
  let block = Buffer.alloc(0);
  let offset = 0;
  function refill() {
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(counter);
    counter += 1n;
    block = createHmac('sha256', key)
      .update('card-club/shuffle/rng/v1', 'utf8')
      .update(Buffer.from(contextDigest, 'hex'))
      .update(counterBuffer)
      .digest();
    offset = 0;
  }
  function nextUint32() {
    if (offset + 4 > block.length) refill();
    const value = block.readUInt32BE(offset);
    offset += 4;
    return value;
  }
  return {
    nextInt(maxExclusive) {
      if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x100000000) throw new Error('invalid shuffle range');
      const space = 0x100000000;
      const limit = Math.floor(space / maxExclusive) * maxExclusive;
      let value;
      do value = nextUint32(); while (value >= limit);
      return value % maxExclusive;
    },
  };
}

function deriveFinalSeed(manifest, serverSeed, participantSeeds) {
  const context = manifest.context;
  const fields = [context.tenantId, context.tableId, context.handId, context.gameId, serverSeed];
  for (const entry of participantSeeds) fields.push(entry.id, entry.seed);
  return hashFields('card-club/shuffle/final-seed/v1', fields);
}

function deterministicShuffle(canonicalDeck, finalSeed, manifestDigest) {
  const deck = validateCanonicalDeck(canonicalDeck);
  const rng = createDeterministicRng(finalSeed, manifestDigest);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = rng.nextInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function computeDeckDigest(deck) {
  return hashFields('card-club/shuffle/deck/v1', deck.map((card) => card.id));
}

export function generateShuffleSeed() {
  return randomBytes(32).toString('hex');
}

export function commitShuffleSeed({ context, role, actorId, seed }) {
  const normalized = normalizeContext(context);
  if (role !== 'server' && role !== 'participant') throw new Error('shuffle commitment role must be server or participant');
  const id = assertId(actorId, 'shuffle actor id');
  validateSeed(seed);
  return hashFields('card-club/shuffle/seed-commit/v1', [
    role,
    id,
    normalized.tenantId,
    normalized.tableId,
    normalized.handId,
    normalized.gameId,
    seed,
  ]);
}

export function buildShuffleManifest({ context, serverCommitment, participants }) {
  const core = manifestCore({ context, serverCommitment, participants });
  return deepFreeze({ ...core, manifestDigest: computeManifestDigest(core) });
}

export function finalizeCommittedShuffle({ canonicalDeck, manifest, serverSeed, participantSeeds }) {
  if (!manifest || typeof manifest !== 'object') throw new Error('shuffle manifest required');
  const core = manifestCore(manifest);
  const manifestDigest = computeManifestDigest(core);
  if (manifest.manifestDigest !== manifestDigest) throw new Error('shuffle manifest digest mismatch');
  validateSeed(serverSeed, 'server shuffle seed');
  const expectedServer = commitShuffleSeed({ context: core.context, role: 'server', actorId: 'server', seed: serverSeed });
  if (expectedServer !== core.serverCommitment) throw new Error('server shuffle reveal does not match commitment');
  if (!Array.isArray(participantSeeds) || participantSeeds.length !== core.participants.length) throw new Error('shuffle participant reveal count mismatch');
  const revealMap = new Map();
  for (const reveal of participantSeeds) {
    if (!reveal || typeof reveal !== 'object') throw new Error('invalid shuffle participant reveal');
    const id = assertId(reveal.id, 'shuffle participant reveal id');
    if (revealMap.has(id)) throw new Error('duplicate shuffle participant reveal');
    revealMap.set(id, validateSeed(reveal.seed, 'participant shuffle seed'));
  }
  const sortedReveals = core.participants.map((participant) => {
    const seed = revealMap.get(participant.id);
    if (!seed) throw new Error(`missing shuffle reveal for ${participant.id}`);
    const expected = commitShuffleSeed({ context: core.context, role: 'participant', actorId: participant.id, seed });
    if (expected !== participant.commitment) throw new Error(`shuffle reveal commitment mismatch for ${participant.id}`);
    return { id: participant.id, seed };
  });
  const finalSeed = deriveFinalSeed(core, serverSeed, sortedReveals);
  const deck = deterministicShuffle(canonicalDeck, finalSeed, manifestDigest);
  const deckDigest = computeDeckDigest(deck);
  const publicReceipt = deepFreeze({
    version: 1,
    algorithm: ALGORITHM,
    context: core.context,
    manifestDigest,
    serverCommitment: core.serverCommitment,
    participants: core.participants,
    deckDigest,
  });
  const disclosure = deepFreeze({
    ...publicReceipt,
    serverSeed,
    participantSeeds: sortedReveals,
    orderedCardIds: deck.map((card) => card.id),
  });
  return deepFreeze({ deck, publicReceipt, disclosure });
}

export function verifyShuffleDisclosure(canonicalDeck, disclosure) {
  if (!disclosure || typeof disclosure !== 'object' || disclosure.algorithm !== ALGORITHM) throw new Error('unsupported shuffle disclosure');
  const manifest = buildShuffleManifest({
    context: disclosure.context,
    serverCommitment: disclosure.serverCommitment,
    participants: disclosure.participants,
  });
  if (manifest.manifestDigest !== disclosure.manifestDigest) throw new Error('shuffle disclosure manifest mismatch');
  const rebuilt = finalizeCommittedShuffle({
    canonicalDeck,
    manifest,
    serverSeed: disclosure.serverSeed,
    participantSeeds: disclosure.participantSeeds,
  });
  if (rebuilt.publicReceipt.deckDigest !== disclosure.deckDigest) throw new Error('shuffle disclosure deck digest mismatch');
  if (!Array.isArray(disclosure.orderedCardIds) || disclosure.orderedCardIds.length !== rebuilt.deck.length) throw new Error('shuffle disclosure ordered deck missing');
  for (let index = 0; index < rebuilt.deck.length; index += 1) {
    if (rebuilt.deck[index].id !== disclosure.orderedCardIds[index]) throw new Error(`shuffle disclosure order mismatch at ${index}`);
  }
  return deepFreeze({ valid: true, deck: rebuilt.deck, deckDigest: rebuilt.publicReceipt.deckDigest, manifestDigest: rebuilt.publicReceipt.manifestDigest });
}

export const FAIR_SHUFFLE_ALGORITHM = ALGORITHM;
