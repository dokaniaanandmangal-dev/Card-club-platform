const DIGEST_REF = /^[^\s@]+@sha256:[0-9a-f]{64}$/;

export function assertDigestImageRef(ref) {
  if (typeof ref !== 'string' || !DIGEST_REF.test(ref)) {
    throw new Error('deployment image must be pinned by sha256 digest');
  }
  return ref;
}
