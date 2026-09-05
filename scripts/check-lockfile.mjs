import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));

if (lock.lockfileVersion !== 3) throw new Error('package-lock.json must use lockfileVersion 3');
if (pkg.name !== lock.name || pkg.version !== lock.version) throw new Error('package.json and lockfile identity mismatch');
if (!lock.packages?.['']) throw new Error('lockfile root package entry missing');
console.log('lockfile: verified');
