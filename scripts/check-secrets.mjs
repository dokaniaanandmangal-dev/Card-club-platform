import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const excluded = new Set(['.git', 'node_modules', 'coverage']);
const patterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['github-token', /gh[pousr]_[A-Za-z0-9]{30,}/],
  ['aws-access-key', /AKIA[0-9A-Z]{16}/],
];
const findings = [];

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else {
      if (path.endsWith('check-secrets.mjs')) continue;
      const text = await readFile(path, 'utf8').catch(() => null);
      if (text === null) continue;
      for (const [name, regex] of patterns) {
        if (regex.test(text)) findings.push(`${relative(root, path)}: ${name}`);
      }
    }
  }
}

await walk(root);
if (findings.length) {
  console.error(findings.join('\n'));
  process.exit(1);
}
console.log('secrets: no high-confidence credential patterns found');
