/* global localStorage, document, innerWidth */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
import process from 'node:process';

/** Optional real-browser QA; uses an existing external Playwright install. */
export async function verifyBoardAccessBrowser(ctx) {
  assert(
    process.env.PLAYWRIGHT_MODULE_PATH,
    'Set PLAYWRIGHT_MODULE_PATH to the installed Playwright package',
  );
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH);
  const { ConfigService } = require('@nestjs/config');
  const frontendRequire = createRequire(
    new URL('../../../frontend/package.json', import.meta.url),
  );
  const frontend = fileURLToPath(
    new URL('../../../frontend/', import.meta.url),
  );
  const vite = resolve(
    dirname(frontendRequire.resolve('vite/package.json')),
    'bin/vite.js',
  );
  const output =
    process.env.P2_05_QA_OUTPUT ??
    fileURLToPath(
      new URL(
        '../../../../docs/design/screens/implementation/board-visibility-access-control/',
        import.meta.url,
      ),
    );
  const {
    app,
    send,
    tokens,
    access: { board, card, team, other },
  } = ctx;
  const api = await app.getUrl();
  const server = spawn(
    process.execPath,
    [vite, '--host', '127.0.0.1', '--port', '0'],
    {
      cwd: frontend,
      env: { ...process.env, VITE_API_BASE_URL: `${api}/api` },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  let browser;
  const manifest = [];
  try {
    const origin = await new Promise((done, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Vite did not start')),
        30000,
      );
      server.once('error', reject);
      server.once('exit', () => reject(new Error('Vite exited before QA')));
      server.stdout.on('data', (data) => {
        const match = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) {
          clearTimeout(timer);
          done(match[0]);
        }
      });
    });
    // Only the disposable application accepts this exact random browser origin.
    const origins = app.get(ConfigService).get('CORS_ORIGINS');
    assert(Array.isArray(origins));
    origins.push(origin);
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    await mkdir(output, { recursive: true });
    for (const theme of ['light', 'dark'])
      for (const width of [375, 768, 1280]) {
        await send('admin', 'patch', `/api/boards/${board.id}/visibility`)
          .send({ visibility: 'WORKSPACE_VISIBLE' })
          .expect(200);
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme: theme,
        });
        await context.addInitScript(
          (accessToken) =>
            localStorage.setItem(
              'kanban.session',
              JSON.stringify({ accessToken, expiresAt: Date.now() + 3600000 }),
            ),
          tokens.admin2,
        );
        const page = await context.newPage();
        const errors = [];
        const memberReads = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('request', (request) => {
          if (request.url().includes(`/boards/${board.id}/members`))
            memberReads.push(request.url());
        });
        const capture = async (name) => {
          await page.screenshot({
            path: resolve(output, `${name}-${width}-${theme}.png`),
            fullPage: true,
          });
          manifest.push({
            name,
            width,
            theme,
            screenshot: `${name}-${width}-${theme}.png`,
            errors: [...errors],
            overflow: await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
          });
          assert.deepEqual(errors, []);
        };
        try {
          await page.goto(`${origin}/boards`);
          await page
            .getByRole('link', { name: board.name, exact: true })
            .last()
            .waitFor();
          assert.equal(
            await page.getByText(other.name, { exact: true }).count(),
            0,
          );
          await capture('boards');
          await page.goto(`${origin}/workspaces/${team.id}/boards`);
          await page
            .getByRole('link', { name: `Open ${board.name}` })
            .waitFor();
          await page.getByText('Workspace visible', { exact: true }).waitFor();
          assert.equal(
            await page
              .getByRole('button', { name: `Actions for ${board.name}` })
              .count(),
            0,
          );
          await capture('workspace-boards');
          if (width === 375) {
            await page
              .getByRole('link', { name: `Open ${board.name}` })
              .scrollIntoViewIfNeeded();
            await capture('workspace-boards-content');
          }
          await page.goto(`${origin}/boards/${board.id}`);
          await page
            .getByRole('heading', { name: board.name, exact: true })
            .waitFor();
          await page.getByText('Read only', { exact: true }).waitFor();
          await page
            .getByRole('button', { name: /viewing\. Show viewers/ })
            .waitFor();
          assert.equal(
            await page
              .getByRole('link', { name: 'Members', exact: true })
              .count(),
            0,
          );
          assert.equal(
            await page
              .getByRole('button', { name: 'Add column', exact: true })
              .count(),
            0,
          );
          await capture('board');
          await page
            .getByRole('button', { name: 'Activity', exact: true })
            .click();
          await page
            .getByRole('dialog', { name: 'Activity', exact: true })
            .getByRole('list', { name: 'Activity', exact: true })
            .waitFor();
          await capture('activity');
          await page.goto(`${origin}/boards/${board.id}/cards/${card.id}`);
          await page.getByRole('dialog').waitFor();
          await page.getByText('Comment', { exact: true }).waitFor();
          assert.equal(
            await page
              .getByRole('button', { name: 'Save card', exact: true })
              .count(),
            0,
          );
          assert.equal(
            await page
              .getByRole('dialog')
              .locator(
                'input:not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly]), [contenteditable=true]',
              )
              .count(),
            0,
          );
          await capture('card');
          assert.equal(memberReads.length, 0);
          await page.goto(`${origin}/boards/${board.id}`);
          await page
            .getByRole('button', { name: /viewing\. Show viewers/ })
            .waitFor();
          await send('admin', 'patch', `/api/boards/${board.id}/visibility`)
            .send({ visibility: 'PRIVATE' })
            .expect(200);
          await page
            .getByRole('heading', { name: 'Board not found', exact: true })
            .waitFor();
          assert(
            !(await page.locator('main').textContent()).includes(board.name),
          );
          await capture('revoked');
        } finally {
          await context.close();
        }
      }
    assert(
      manifest.every((item) => !item.overflow),
      'Unexpected page overflow',
    );
    await writeFile(
      resolve(output, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
  } finally {
    await browser?.close();
    server.kill();
  }
}
