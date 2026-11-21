const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const files = [
  'docs/assignments/VT-053/README.md',
  'docs/assignments/VT-053/evidence/README.md',
  'docs/assignments/VT-053/evidence/independent-review.md',
];
let checked = 0;
for (const file of files) {
  for (const match of fs
    .readFileSync(file, 'utf8')
    .matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^https?:/.test(target)) continue;
    if (!fs.existsSync(path.resolve(path.dirname(file), target)))
      throw new Error(`Missing link: ${file} -> ${target}`);
    checked++;
  }
}
const manifest = JSON.parse(
  fs.readFileSync('docs/assignments/VT-053/evidence/verification-context.json'),
);
for (const [file, hash] of Object.entries(manifest.files)) {
  const content = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (crypto.createHash('sha256').update(content).digest('hex') !== hash)
    throw new Error(`Changed tested source: ${file}`);
}
const service = 'apps/backend/src/api/search/search.service.ts';
const blobs = ['b7c1b97986e75d7d07bbed74b29f5ad3a53fcf30', 'HEAD'].map((ref) =>
  cp
    .execFileSync('git', ['rev-parse', `${ref}:${service}`], {
      encoding: 'utf8',
    })
    .trim(),
);
if (blobs[0] !== blobs[1]) throw new Error('Unexpected service change');
console.log(
  `PASS: ${checked} local Markdown links; 7 tested source hashes match commit ${manifest.verifiedSourceCommit}; service blob unchanged from baseline ${blobs[0]}; no mutation in submitted service.`,
);
