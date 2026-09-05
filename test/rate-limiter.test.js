import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucketRateLimiter } from '../src/security/rate-limiter.js';

test('token bucket limits bursts and refills predictably', () => {
  const limiter = new TokenBucketRateLimiter({ capacity: 3, refillPerSecond: 1 });
  assert.equal(limiter.take('club-a|ip-1', { now: 0 }).allowed, true);
  assert.equal(limiter.take('club-a|ip-1', { now: 0 }).allowed, true);
  assert.equal(limiter.take('club-a|ip-1', { now: 0 }).allowed, true);
  const denied = limiter.take('club-a|ip-1', { now: 0 });
  assert.equal(denied.allowed, false);
  assert.equal(denied.code, 'rate_limited');
  assert.equal(denied.retryAfterMs, 1000);
  assert.equal(limiter.take('club-a|ip-1', { now: 1000 }).allowed, true);
});

test('subjects are isolated and clock rollback cannot refill tokens', () => {
  const limiter = new TokenBucketRateLimiter({ capacity: 1, refillPerSecond: 1 });
  assert.equal(limiter.take('a', { now: 1000 }).allowed, true);
  assert.equal(limiter.take('a', { now: 500 }).allowed, false);
  assert.equal(limiter.take('b', { now: 500 }).allowed, true);
});

test('rate key cardinality is bounded', () => {
  const limiter = new TokenBucketRateLimiter({ capacity: 1, refillPerSecond: 1, maxKeys: 10 });
  for (let i = 0; i < 100; i += 1) limiter.take(`subject-${i}`, { now: i });
  assert.equal(limiter.size, 10);
});

test('100,000-request burst is deterministically contained', () => {
  const limiter = new TokenBucketRateLimiter({ capacity: 20, refillPerSecond: 5, maxKeys: 2000 });
  let allowed = 0;
  let denied = 0;
  for (let i = 0; i < 100_000; i += 1) {
    const result = limiter.take(`subject-${i % 1000}`, { now: 0 });
    if (result.allowed) allowed += 1;
    else denied += 1;
  }
  assert.equal(allowed, 20_000);
  assert.equal(denied, 80_000);
});
