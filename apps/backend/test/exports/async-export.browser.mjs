import assert from 'node:assert/strict';
import console from 'node:console';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
/* global localStorage, innerWidth, document */

/** Real browser/API/database; each responsive layout has its own live operation. */
export async function browserJourney({ backendUrl, token, boardId, boards }) {
  assert.equal(new URL(backendUrl).port, '3009');
  const require = createRequire(import.meta.url);
  assert.ok(process.env.VT054_PLAYWRIGHT_ROOT);
  const { chromium } = require(process.env.VT054_PLAYWRIGHT_ROOT);
  const browser = await chromium.launch({ headless: true });
  const output = resolve(
    'docs/design/screens/implementation/vt054-async-export/direct',
  );
  await mkdir(output, { recursive: true });
  const original = boards.create.bind(boards),
    records = [];
  try {
    for (const [name, width, height] of [
      ['mobile', 375, 812],
      ['tablet', 768, 1024],
      ['laptop', 1280, 800],
      ['desktop', 1440, 900],
    ]) {
      for (const theme of ['light', 'dark']) {
        let release;
        const gate = new Promise((resolveGate) => {
          release = resolveGate;
        });
        boards.create = async (...args) => {
          await gate;
          return original(...args);
        };
        const context = await browser.newContext({
          viewport: { width, height },
          colorScheme: theme,
          reducedMotion: 'reduce',
          acceptDownloads: true,
        });
        let page;
        const observations = [];
        try {
          await context.addInitScript(
            ({ token }) => {
              if (localStorage.getItem('kanban.session')) return;
              localStorage.setItem(
                'kanban.session',
                JSON.stringify({
                  accessToken: token,
                  expiresAt: Date.now() + 3_600_000,
                }),
              );
            },
            { token },
          );
          page = await context.newPage();
          page.on('framenavigated', (frame) => {
            if (frame === page.mainFrame())
              observations.push({ navigation: frame.url() });
          });
          page.on('console', (message) => {
            if (message.text().includes('[vite]'))
              observations.push({ console: message.text() });
          });
          page.on('response', (response) => {
            if (response.url().includes('/api/'))
              observations.push({
                path: new URL(response.url()).pathname,
                status: response.status(),
              });
          });
          page.on('requestfailed', (request) =>
            observations.push({
              failed: new URL(request.url()).pathname,
              error: request.failure()?.errorText,
            }),
          );
          await page.goto(
            `${process.env.VT054_BROWSER_URL}/settings/data-privacy`,
          );
          const card = page.getByRole('region', { name: 'Export board data' });
          await card
            .getByLabel('Board', { exact: true })
            .selectOption(boardId, { timeout: 15000 });
          const ack = page.waitForResponse(
            (response) =>
              response.request().method() === 'POST' &&
              response.url().endsWith('/export-jobs'),
          );
          await card
            .getByRole('button', { name: 'Export board data', exact: true })
            .press('Enter');
          const response = await ack;
          assert.equal(response.status(), 202);
          const job = await response.json();
          const progress = card.getByRole('status');
          await progress
            .filter({ hasText: 'Preparing your board export.' })
            .waitFor({ timeout: 15000 });
          assert.equal(
            await card
              .getByRole('button', { name: 'Preparing export…' })
              .isDisabled(),
            true,
          );
          await card.scrollIntoViewIfNeeded();
          assert.equal(
            await progress.innerText(),
            'Preparing your board export.',
          );
          if (!process.env.VT054_BROWSER_NO_SCREENSHOT)
            await page.screenshot({
              path: resolve(output, `${name}-${theme}-running.png`),
              fullPage: true,
            });
          const layout = await page.evaluate(() => ({
            viewport: innerWidth,
            width: document.documentElement.scrollWidth,
            appliedTheme: document.documentElement.dataset.theme,
          }));
          assert.ok(
            layout.width <= width,
            `${name}/${theme}: horizontal overflow`,
          );
          assert.equal(layout.appliedTheme, theme);
          const downloadEvent = page.waitForEvent('download');
          release();
          const download = await downloadEvent;
          assert.match(
            download.suggestedFilename(),
            new RegExp(
              `^kanvexa-board-${boardId}-\\d{4}-\\d{2}-\\d{2}\\.json$`,
            ),
          );
          assert.equal(
            JSON.parse(await readFile(await download.path(), 'utf8')).board.id,
            boardId,
          );
          await card.getByText('Download started.', { exact: true }).waitFor();
          if (name === 'desktop' && theme === 'dark')
            await page.screenshot({
              path: resolve(output, 'desktop-dark-completed.png'),
              fullPage: true,
            });
          records.push({
            name,
            width,
            height,
            theme,
            ...layout,
            jobId: job.id,
            download: 'validated actual JSON',
          });
          console.log(
            `PASS browser ${name}/${theme}: keyboard start, visible RUNNING, real JSON download, no page overflow`,
          );
        } catch (error) {
          console.log('Browser diagnostic:', JSON.stringify(observations));
          if (page) {
            await page.screenshot({
              path: resolve(output, `${name}-${theme}-failure.png`),
              fullPage: true,
            });
            console.log(
              'Browser card on failure:',
              await page
                .getByRole('region', { name: 'Export board data' })
                .innerText(),
            );
          }
          throw error;
        } finally {
          release();
          boards.create = original;
          await context.close();
        }
      }
    }
    await writeFile(
      resolve(output, 'browser-results.json'),
      JSON.stringify(
        {
          browser: browser.version(),
          api: 'direct real Nest JWT REST and Socket.IO on port 3009 + disposable PostgreSQL',
          records,
        },
        null,
        2,
      ),
    );
  } finally {
    boards.create = original;
    await browser.close();
  }
}
