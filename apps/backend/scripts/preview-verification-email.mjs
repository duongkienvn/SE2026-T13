import console from 'node:console';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';

// QA only: do not load the app, .env, a mail client or real recipient/token data.
const require = createRequire(import.meta.url);
const { verificationEmail } = require('../dist/mail/verification-email.js');
const output = new URL(
  '../../../.codex/previews/verification-email/',
  import.meta.url,
);
const sampleUrl =
  'https://example.invalid/verify-email?token=preview-only-not-a-real-token';
const normal = verificationEmail(sampleUrl);
const long = verificationEmail(
  `${sampleUrl}-${'synthetic-preview-'.repeat(80)}`,
);
const blocked = normal.html.replace(
  'src="https://kanvexa.tech/branding/kanvexa-logo-v1.png"',
  'src="https://example.invalid/blocked-logo.png"',
);

await mkdir(output, { recursive: true });
for (const [name, content] of [
  ['verification-email.html', normal.html],
  ['verification-email-long-url.html', long.html],
  ['verification-email-images-blocked.html', blocked],
  ['verification-email.txt', normal.text],
]) {
  await writeFile(new URL(name, output), content, 'utf8');
}
console.log(`Synthetic email previews written to ${fileURLToPath(output)}`);
