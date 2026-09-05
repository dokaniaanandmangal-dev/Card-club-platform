import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDigestImageRef } from '../src/security/image-ref.js';

const digest = 'a'.repeat(64);

test('deployment accepts digest-pinned image references', () => {
  assert.equal(
    assertDigestImageRef(`ghcr.io/example/card-club@sha256:${digest}`),
    `ghcr.io/example/card-club@sha256:${digest}`,
  );
});

test('deployment rejects mutable tags and malformed digests', () => {
  assert.throws(() => assertDigestImageRef('ghcr.io/example/card-club:latest'));
  assert.throws(() => assertDigestImageRef('ghcr.io/example/card-club@sha256:abc'));
  assert.throws(() => assertDigestImageRef(''));
});
