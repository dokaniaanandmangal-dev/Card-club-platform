const UNSIGNED_MINOR_RE = /^(0|[1-9][0-9]{0,18})$/;
export const PG_BIGINT_MAX = 9_223_372_036_854_775_807n;

export function parseUnsignedMinor(value, field = 'amount') {
  if (typeof value !== 'string' || !UNSIGNED_MINOR_RE.test(value)) {
    throw new Error(`${field}:invalid_minor_unit_string`);
  }
  const parsed = BigInt(value);
  if (parsed > PG_BIGINT_MAX) throw new Error(`${field}:out_of_range`);
  return parsed;
}

export function formatSignedMinor(value) {
  if (typeof value !== 'bigint') throw new TypeError('minor unit value must be bigint');
  if (value > PG_BIGINT_MAX || value < -PG_BIGINT_MAX) throw new Error('signed_minor_out_of_range');
  return value.toString();
}
