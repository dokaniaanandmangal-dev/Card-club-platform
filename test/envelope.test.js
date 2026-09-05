import test from 'node:test';
import assert from 'node:assert/strict';
import { ENVELOPE_LIMITS, validateEnvelope } from '../src/security/envelope.js';

const now = 1_800_000_000_000;
const valid = () => ({
  type: 'table.action',
  requestId: 'Rq_0123456789abcdef',
  timestamp: now,
  payload: { action: 'check', amount: 10 },
});

function reject(name, mutate, code) {
  test(name, () => {
    const envelope = valid();
    mutate(envelope);
    assert.deepEqual(validateEnvelope(envelope, { now }), { ok: false, code });
  });
}

test('accepts canonical envelope', () => {
  assert.equal(validateEnvelope(valid(), { now }).ok, true);
});

reject('rejects null envelope', e => Object.assign(e, { payload: null }), 'invalid_payload');
reject('rejects unknown top-level field', e => { e.admin = true; }, 'unknown_field');
reject('rejects empty type', e => { e.type = ''; }, 'invalid_type');
reject('rejects uppercase type', e => { e.type = 'ADMIN'; }, 'invalid_type');
reject('rejects short request id', e => { e.requestId = 'short'; }, 'invalid_request_id');
reject('rejects non-integer timestamp', e => { e.timestamp = 'now'; }, 'invalid_timestamp');
reject('rejects stale timestamp', e => { e.timestamp = now - ENVELOPE_LIMITS.maxClockSkewMs - 1; }, 'timestamp_out_of_window');
reject('rejects future timestamp beyond skew', e => { e.timestamp = now + ENVELOPE_LIMITS.maxClockSkewMs + 1; }, 'timestamp_out_of_window');
reject('rejects array payload', e => { e.payload = []; }, 'invalid_payload');
reject('rejects oversized string', e => { e.payload.message = 'x'.repeat(ENVELOPE_LIMITS.maxStringLength + 1); }, 'string_too_long');
reject('rejects oversized array', e => { e.payload.cards = Array(ENVELOPE_LIMITS.maxArrayLength + 1).fill(1); }, 'array_too_large');
reject('rejects oversized object', e => { e.payload = Object.fromEntries(Array.from({ length: ENVELOPE_LIMITS.maxObjectKeys + 1 }, (_, i) => [`k${i}`, i])); }, 'object_too_large');

test('rejects excessive nesting', () => {
  const e = valid();
  let cursor = e.payload;
  for (let i = 0; i < ENVELOPE_LIMITS.maxDepth + 2; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  assert.equal(validateEnvelope(e, { now }).ok, false);
});

test('rejects cyclic data', () => {
  const e = valid();
  e.payload.self = e.payload;
  assert.deepEqual(validateEnvelope(e, { now }), { ok: false, code: 'cyclic_value' });
});

test('rejects dangerous nested constructor key', () => {
  const e = valid();
  e.payload.profile = { constructor: 'pollute' };
  assert.deepEqual(validateEnvelope(e, { now }), { ok: false, code: 'dangerous_key' });
});

test('rejects non-plain nested object', () => {
  const e = valid();
  e.payload.when = new Date(now);
  assert.deepEqual(validateEnvelope(e, { now }), { ok: false, code: 'non_plain_object' });
});

test('accepts safe nested arrays and objects', () => {
  const e = valid();
  e.payload = { cards: ['AS', 'KH'], meta: { seat: 2, flags: [true, false] } };
  assert.equal(validateEnvelope(e, { now }).ok, true);
});

test('rejects byte-size overflow', () => {
  const e = valid();
  e.payload = {};
  for (let i = 0; i < 5; i += 1) e.payload[`part${i}`] = 'x'.repeat(3500);
  assert.deepEqual(validateEnvelope(e, { now }), { ok: false, code: 'envelope_too_large' });
});
