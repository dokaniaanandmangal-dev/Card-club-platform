#!/usr/bin/env node
import { assertDigestImageRef } from '../src/security/image-ref.js';

const ref = process.argv[2];
try {
  console.log(assertDigestImageRef(ref));
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
