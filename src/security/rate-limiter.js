export class TokenBucketRateLimiter {
  constructor({ capacity = 30, refillPerSecond = 10, maxKeys = 10_000 } = {}) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new TypeError('invalid capacity');
    if (!Number.isFinite(refillPerSecond) || refillPerSecond <= 0) throw new TypeError('invalid refill rate');
    if (!Number.isInteger(maxKeys) || maxKeys <= 0) throw new TypeError('invalid maxKeys');
    this.capacity = capacity;
    this.refillPerMs = refillPerSecond / 1000;
    this.maxKeys = maxKeys;
    this.buckets = new Map();
  }

  #evictOldest() {
    let oldestKey;
    let oldestAt = Infinity;
    for (const [key, bucket] of this.buckets) {
      if (bucket.updatedAt < oldestAt) {
        oldestAt = bucket.updatedAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) this.buckets.delete(oldestKey);
  }

  take(key, { now = Date.now(), cost = 1 } = {}) {
    if (typeof key !== 'string' || key.length === 0 || key.length > 256) {
      return { allowed: false, code: 'invalid_rate_key', remaining: 0 };
    }
    if (!Number.isFinite(now) || !Number.isFinite(cost) || cost <= 0 || cost > this.capacity) {
      return { allowed: false, code: 'invalid_rate_request', remaining: 0 };
    }

    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.maxKeys) this.#evictOldest();
      bucket = { tokens: this.capacity, updatedAt: now };
      this.buckets.set(key, bucket);
    }

    const elapsed = Math.max(0, now - bucket.updatedAt);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerMs);
    bucket.updatedAt = Math.max(bucket.updatedAt, now);

    if (bucket.tokens + Number.EPSILON < cost) {
      const deficit = cost - bucket.tokens;
      return {
        allowed: false,
        code: 'rate_limited',
        remaining: Math.floor(bucket.tokens),
        retryAfterMs: Math.ceil(deficit / this.refillPerMs),
      };
    }

    bucket.tokens -= cost;
    return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
  }

  get size() {
    return this.buckets.size;
  }
}
