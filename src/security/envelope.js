const ALLOWED_KEYS = new Set(['type', 'requestId', 'timestamp', 'payload']);
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const TYPE_RE = /^[a-z][a-z0-9_.-]{0,63}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

export const ENVELOPE_LIMITS = Object.freeze({
  maxBytes: 16 * 1024,
  maxClockSkewMs: 60_000,
  maxDepth: 8,
  maxObjectKeys: 128,
  maxArrayLength: 256,
  maxStringLength: 4096,
});

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function validateShape(value, depth = 0, seen = new WeakSet()) {
  if (depth > ENVELOPE_LIMITS.maxDepth) return 'payload_too_deep';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return null;
  if (typeof value === 'string') {
    return value.length <= ENVELOPE_LIMITS.maxStringLength ? null : 'string_too_long';
  }
  if (typeof value !== 'object') return 'unsupported_value_type';
  if (seen.has(value)) return 'cyclic_value';
  seen.add(value);

  if (Array.isArray(value)) {
    if (value.length > ENVELOPE_LIMITS.maxArrayLength) return 'array_too_large';
    for (const item of value) {
      const issue = validateShape(item, depth + 1, seen);
      if (issue) return issue;
    }
    return null;
  }

  if (!isPlainObject(value)) return 'non_plain_object';
  const keys = Object.keys(value);
  if (keys.length > ENVELOPE_LIMITS.maxObjectKeys) return 'object_too_large';
  for (const key of keys) {
    if (DANGEROUS_KEYS.has(key)) return 'dangerous_key';
    const issue = validateShape(value[key], depth + 1, seen);
    if (issue) return issue;
  }
  return null;
}

export function validateEnvelope(input, { now = Date.now() } = {}) {
  if (!isPlainObject(input)) return { ok: false, code: 'invalid_envelope' };

  for (const key of Object.keys(input)) {
    if (!ALLOWED_KEYS.has(key)) return { ok: false, code: 'unknown_field' };
  }

  if (!TYPE_RE.test(input.type ?? '')) return { ok: false, code: 'invalid_type' };
  if (!REQUEST_ID_RE.test(input.requestId ?? '')) return { ok: false, code: 'invalid_request_id' };
  if (!Number.isSafeInteger(input.timestamp)) return { ok: false, code: 'invalid_timestamp' };
  if (Math.abs(now - input.timestamp) > ENVELOPE_LIMITS.maxClockSkewMs) {
    return { ok: false, code: 'timestamp_out_of_window' };
  }
  if (!isPlainObject(input.payload)) return { ok: false, code: 'invalid_payload' };

  const payloadIssue = validateShape(input.payload);
  if (payloadIssue) return { ok: false, code: payloadIssue };

  let encoded;
  try {
    encoded = JSON.stringify(input);
  } catch {
    return { ok: false, code: 'not_serializable' };
  }
  if (Buffer.byteLength(encoded, 'utf8') > ENVELOPE_LIMITS.maxBytes) {
    return { ok: false, code: 'envelope_too_large' };
  }

  return { ok: true, value: input };
}
