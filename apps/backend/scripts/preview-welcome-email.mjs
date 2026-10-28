import console from 'node:console';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';

// Synthetic, offline QA: no app bootstrap, .env, database or mail client.
const require = createRequire(import.meta.url);
const { welcomeEmail } = require('../dist/mail/welcome-email.js');
const output = new URL(
  '../../../.codex/previews/welcome-email/',
  import.meta.url,
);
await mkdir(output, { recursive: true });
await copyFile(
  new URL(
    '../../frontend/public/branding/kanvexa-logo-v1.png',
    import.meta.url,
  ),
  new URL('kanvexa-logo-v1.png', output),
);
const normal = welcomeEmail('https://kanvexa.tech');
// Only the preview asset URL differs from the actual delivered message.
const offline = (html) =>
  html.replace(
    'https://kanvexa.tech/branding/kanvexa-logo-v1.png',
    './kanvexa-logo-v1.png',
  );
const blocked = normal.html.replace(
  /<img\b[^>]*>/,
  '<span aria-hidden="true" style="display:block;width:48px;height:48px"></span>',
);
const long = welcomeEmail(
  `https://${'preview-only-'.repeat(4)}.${'long-origin-'.repeat(4)}.example.test`,
);
for (const [name, content] of [
  ['welcome-email.html', offline(normal.html)],
  ['welcome-email-images-blocked.html', blocked],
  ['welcome-email-long-url.html', offline(long.html)],
  ['welcome-email.txt', normal.text],
])
  await writeFile(new URL(name, output), content, 'utf8');
console.log(`Synthetic welcome previews written to ${fileURLToPath(output)}`);
