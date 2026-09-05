import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketAbuseGuard } from '../src/security/websocket-guard.js';

test('connection flood is capped per authenticated subject', () => {
  const guard = new WebSocketAbuseGuard({ maxConnectionsPerSubject: 2 });
  assert.equal(guard.open({ subject: 'player-1', connectionId: 'conn-0001', now: 0 }).allowed, true);
  assert.equal(guard.open({ subject: 'player-1', connectionId: 'conn-0002', now: 0 }).allowed, true);
  assert.deepEqual(guard.open({ subject: 'player-1', connectionId: 'conn-0003', now: 0 }), {
    allowed: false,
    code: 'connection_limit',
  });
  assert.equal(guard.open({ subject: 'player-2', connectionId: 'conn-0004', now: 0 }).allowed, true);
});

test('oversized frames, message floods and in-flight overload fail closed', () => {
  const guard = new WebSocketAbuseGuard({
    maxFrameBytes: 32,
    maxMessagesPerWindow: 2,
    windowMs: 1000,
    maxInFlight: 1,
  });
  guard.open({ subject: 'player-1', connectionId: 'conn-1000', now: 0 });
  assert.equal(guard.inspectFrame({ connectionId: 'conn-1000', bytes: 33, now: 0 }).code, 'frame_too_large');
  assert.equal(guard.inspectFrame({ connectionId: 'conn-1000', bytes: 10, now: 0 }).allowed, true);
  assert.equal(guard.inspectFrame({ connectionId: 'conn-1000', bytes: 10, now: 0 }).code, 'backpressure_limit');
  assert.equal(guard.completeFrame('conn-1000'), true);
  assert.equal(guard.inspectFrame({ connectionId: 'conn-1000', bytes: 10, now: 0 }).allowed, true);
  guard.completeFrame('conn-1000');
  assert.equal(guard.inspectFrame({ connectionId: 'conn-1000', bytes: 10, now: 0 }).code, 'message_rate_limit');
  assert.equal(guard.inspectFrame({ connectionId: 'conn-1000', bytes: 10, now: 1000 }).allowed, true);
});

test('100,000-frame abuse/load simulation enforces the configured window', () => {
  const guard = new WebSocketAbuseGuard({
    maxConnectionsPerSubject: 4,
    maxMessagesPerWindow: 50,
    maxInFlight: 8,
  });

  for (let subject = 0; subject < 250; subject += 1) {
    for (let c = 0; c < 4; c += 1) {
      assert.equal(guard.open({
        subject: `player-${subject}`,
        connectionId: `conn-${subject}-${c}-0000`,
        now: 0,
      }).allowed, true);
    }
  }

  let allowed = 0;
  let denied = 0;
  for (let i = 0; i < 100_000; i += 1) {
    const subject = i % 250;
    const c = i % 4;
    const connectionId = `conn-${subject}-${c}-0000`;
    const result = guard.inspectFrame({ connectionId, bytes: 64, now: 0 });
    if (result.allowed) {
      allowed += 1;
      guard.completeFrame(connectionId);
    } else {
      denied += 1;
    }
  }

  assert.equal(allowed, 50_000);
  assert.equal(denied, 50_000);
});
