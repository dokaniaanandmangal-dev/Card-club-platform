import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTeenPattiDeck } from '../src/game/teen-patti/cards.js';
import { commitShuffleSeed } from '../src/game/fair-shuffle.js';
import {
  abortAuditedShuffle,
  beginAuditedShuffle,
  issueAuditedDeck,
  recordShuffleDisclosure,
  routeAuditedDeck,
} from '../src/game/shuffle-orchestrator.js';
import { createPostgresShuffleAuditPersistence } from '../src/game/postgres-shuffle-audit-adapter.js';

const connectionString = process.env.PG_INTEGRATION_URL;

function seedFixture(context) {
  const serverSeed = 'ab'.repeat(32);
  const aliceSeed = 'cd'.repeat(32);
  const bobSeed = 'ef'.repeat(32);
  return {
    serverSeed,
    participantSeeds: [
      { id: 'alice', seed: aliceSeed },
      { id: 'bob', seed: bobSeed },
    ],
    serverCommitment: commitShuffleSeed({ context, role: 'server', actorId: 'server', seed: serverSeed }),
    participants: [
      { id: 'alice', commitment: commitShuffleSeed({ context, role: 'participant', actorId: 'alice', seed: aliceSeed }) },
      { id: 'bob', commitment: commitShuffleSeed({ context, role: 'participant', actorId: 'bob', seed: bobSeed }) },
    ],
  };
}

test('PostgreSQL shuffle audit persistence gates deck routing and records abort/disclosure evidence', { skip: !connectionString }, async (t) => {
  const persistence = createPostgresShuffleAuditPersistence({ connectionString });
  t.after(async () => persistence.close());

  const issuedContext = {
    tenantId: 'tenant-js',
    tableId: 'table-js',
    handId: 'hand-js-issued',
    gameId: 'teen-patti',
  };
  const issuedSeeds = seedFixture(issuedContext);
  const session = await beginAuditedShuffle({
    canonicalDeck: buildTeenPattiDeck(),
    context: issuedContext,
    serverCommitment: issuedSeeds.serverCommitment,
    participants: issuedSeeds.participants,
    persistence,
  });

  const issued = await issueAuditedDeck(session, {
    serverSeed: issuedSeeds.serverSeed,
    participantSeeds: issuedSeeds.participantSeeds,
  });
  const ids = routeAuditedDeck(issued, deck => deck.map((card) => card.id));
  assert.equal(ids.length, 52);
  assert.equal(new Set(ids).size, 52);

  await recordShuffleDisclosure(session, issued.disclosure);
  const audit = await persistence.loadAudit(session.manifest.manifestDigest);
  assert.equal(audit.tenantId, issuedContext.tenantId);
  assert.equal(audit.events.length, 2);
  assert.deepEqual(audit.events.map((event) => event.eventType), ['deck_issued', 'disclosed']);
  assert.equal(audit.events[0].deckDigest, issued.publicReceipt.deckDigest);
  assert.equal(audit.events[1].deckDigest, issued.publicReceipt.deckDigest);
  assert.match(audit.events[1].detailDigest, /^[0-9a-f]{64}$/);
  await assert.rejects(
    () => abortAuditedShuffle(session, { reasonCode: 'server_cancelled' }),
    /shuffle_abort_invalid_state/,
  );

  const abortContext = {
    tenantId: 'tenant-js',
    tableId: 'table-js',
    handId: 'hand-js-aborted',
    gameId: 'teen-patti',
  };
  const abortSeeds = seedFixture(abortContext);
  const abortSession = await beginAuditedShuffle({
    canonicalDeck: buildTeenPattiDeck(),
    context: abortContext,
    serverCommitment: abortSeeds.serverCommitment,
    participants: abortSeeds.participants,
    persistence,
  });
  await abortAuditedShuffle(abortSession, { reasonCode: 'participant_reveal_timeout' });
  const abortedAudit = await persistence.loadAudit(abortSession.manifest.manifestDigest);
  assert.equal(abortedAudit.events.length, 1);
  assert.equal(abortedAudit.events[0].eventType, 'aborted');
  assert.equal(abortedAudit.events[0].reasonCode, 'participant_reveal_timeout');
  await assert.rejects(
    () => issueAuditedDeck(abortSession, {
      serverSeed: abortSeeds.serverSeed,
      participantSeeds: abortSeeds.participantSeeds,
    }),
    /shuffle_deck_issue_invalid_state/,
  );
});
