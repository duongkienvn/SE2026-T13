import console from 'node:console';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';

// Synthetic offline preview only: no app bootstrap, .env, DB or mail transport.
const require = createRequire(import.meta.url);
const {
  workspaceInvitationEmail,
} = require('../dist/mail/workspace-invitation-email.js');
const output = new URL(
  '../../../.codex/previews/workspace-invitation-email/',
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
const payload = {
  invitationId: 'preview-only',
  workspaceId: 'preview-only',
  workspaceName: 'Product & Design',
  recipient: 'teammate@example.test',
  role: 'MEMBER',
  proof: 'a'.repeat(43),
  expiresAt: new Date('2026-11-04T09:30:00Z'),
  idempotencyKey: 'preview-only',
};
// A QA-only path, not an implemented or approved production acceptance route.
const render = (data) =>
  workspaceInvitationEmail(data, 'https://example.test', '/qa/invitation');
const normal = render(payload);
const long = render({
  ...payload,
  workspaceName: `Dự án 東京 — Research & Development ${'InternationalCollaboration'.repeat(8)}`,
  recipient: `${'long-address-'.repeat(6)}@example.test`,
});
const offline = (html) =>
  html.replace(
    'https://kanvexa.tech/branding/kanvexa-logo-v1.png',
    './kanvexa-logo-v1.png',
  );
for (const [name, content] of [
  ['invitation.html', offline(normal.html)],
  ['invitation-long.html', offline(long.html)],
  [
    'invitation-images-blocked.html',
    normal.html.replace(
      /<img\b[^>]*>/,
      '<span aria-hidden="true" style="display:block;width:48px;height:48px"></span>',
    ),
  ],
  ['invitation.txt', normal.text],
])
  await writeFile(new URL(name, output), content, 'utf8');
console.log(
  `Synthetic invitation previews written to ${fileURLToPath(output)}`,
);
