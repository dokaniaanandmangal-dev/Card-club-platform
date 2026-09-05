import test from 'node:test';
import assert from 'node:assert/strict';
import { ENVELOPE_LIMITS, validateEnvelope } from '../src/security/envelope.js';

const now = 1_800_000_000_000;
const base = () => ({
  type: 'table.action',
  requestId: 'Rq_0123456789abcdef',
  timestamp: now,
  payload: { action: 'check', amount: 10 },
});

const attacks = [
  e => { e.type = ''; },
  e => { e.type = 'ADMIN'; },
  e => { e.type = 'x'.repeat(65); },
  e => { e.requestId = 'short'; },
  e => { e.requestId = 'x'.repeat(65); },
  e => { e.timestamp = now - ENVELOPE_LIMITS.maxClockSkewMs - 1; },
  e => { e.timestamp = now + ENVELOPE_LIMITS.maxClockSkewMs + 1; },
  e => { e.timestamp = Number.MAX_SAFE_INTEGER + 1; },
  e => { e.payload = []; },
  e => { e.payload = null; },
  e => { e.extra = true; },
  e => { e.payload = { constructor: 'pollute' }; },
  e => { e.payload = { prototype: 'pollute' }; },
  e => { e.payload = { message: 'x'.repeat(ENVELOPE_LIMITS.maxStringLength + 1) }; },
  e => { e.payload = { list: Array(ENVELOPE_LIMITS.maxArrayLength + 1).fill(1) }; },
  e => { e.payload = Object.fromEntries(Array.from({ length: ENVELOPE_LIMITS.maxObjectKeys + 1 }, (_, i) => [`k${i}`, i])); },
  e => { let c = e.payload; for (let i = 0; i < ENVELOPE_LIMITS.maxDepth + 2; i += 1) { c.n = {}; c = c.n; } },
  e => { e.payload.self = e.payload; },
  e => { e.payload = { unsupported: 1n }; },
  e => { e.payload = { large1: 'x'.repeat(3500), large2: 'x'.repeat(3500), large3: 'x'.repeat(3500), large4: 'x'.repeat(3500), large5: 'x'.repeat(3500) }; },
];

test('rejects 20,000 deterministic hostile envelopes', () => {
  let rejected = 0;
  for (let round = 0; round < 1000; round += 1) {
    for (const mutate of attacks) {
      const e = base();
      mutate(e, round);
      if (!validateEnvelope(e, { now }).ok) rejected += 1;
    }
  }
  assert.equal(rejected, 20_000);
});
