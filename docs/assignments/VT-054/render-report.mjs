import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';

const dir = resolve('docs/assignments/VT-054');
const output = resolve(process.argv[2] || 'output/pdf/BT3_23001908_VT-054.pdf');
const repo = 'https://github.com/duongkienvn/SE2026-T13';
const [template, reflection, usage] = await Promise.all(
  ['report.html', 'REFLECTION.md', 'AI-USAGE.md'].map((file) =>
    readFile(resolve(dir, file), 'utf8'),
  ),
);
const escape = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
const paragraphs = (markdown) =>
  markdown
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .filter((part) => !part.startsWith('#'))
    .map((part) => '<p>' + escape(part) + '</p>')
    .join('');
const rows = usage
  .split(/\r?\n/)
  .filter((line) => line.startsWith('|') && !line.startsWith('| ---'));
const table =
  '<table>' +
  rows
    .map((row, index) => {
      const tag = index === 0 ? 'th' : 'td';
      return (
        '<tr>' +
        row
          .split('|')
          .slice(1, -1)
          .map(
            (cell) => '<' + tag + '>' + escape(cell.trim()) + '</' + tag + '>',
          )
          .join('') +
        '</tr>'
      );
    })
    .join('') +
  '</table>';
const pr = process.env.VT054_PR_NUMBER;
if (pr) assert.match(pr, /^\d+$/);
const gates = JSON.parse(
  await readFile(resolve(dir, 'evidence/final-gates.json'), 'utf8'),
);
const workspace = await readFile(
  resolve(dir, 'evidence/serial-gates.json'),
  'utf8',
).then(JSON.parse, (error) => {
  if (error.code !== 'ENOENT') throw error;
  return {};
});
const gateSummary =
  '<p>' +
  Object.entries(gates)
    .map(
      ([name, code]) =>
        '<code>pnpm ' +
        escape(name) +
        '</code> ' +
        (code === 0 ? 'pass' : 'fail'),
    )
    .join(' · ') +
  '.</p>';
const workspaceSummary =
  '<p>Kiểm tra từng workspace (exit code): ' +
  Object.entries(workspace)
    .map(([name, code]) => escape(name) + ' ' + code)
    .join(', ') +
  '.</p>';
const excerpts = await Promise.all(
  [
    ['red-http.txt', /Expected: 202|Received: 404|Tests:\s+1 failed/],
    [
      'mutation-mutant.txt',
      /Expected: "csv"|Received: "json"|Tests:\s+1 failed/,
    ],
    ['mutation-restored.txt', /Tests:\s+12 passed/],
    ['worker-drain-red.txt', /Expected: 12|Received: 4/],
    ['worker-drain-green.txt', /Tests:\s+1 passed/],
    ['browser-direct-final.txt', /PASS browser desktop\/dark|5 groups passed/],
  ].map(async ([name, pattern]) => {
    const log = await readFile(resolve(dir, 'evidence', name), 'utf8');
    const lines = log
      .split(/\r?\n/)
      .filter((line) => pattern.test(line))
      .map((line) => line.trim());
    assert.ok(lines.length, name);
    return (
      '<p><strong>' +
      name +
      '</strong></p><pre>' +
      escape(lines.join('\n')) +
      '</pre>'
    );
  }),
);
const html = template
  .replace(
    '<!-- PR_LINK -->',
    pr
      ? '<p>Draft PR <a href="' + repo + '/pull/' + pr + '">#' + pr + '</a></p>'
      : '',
  )
  .replace('<!-- REFLECTION -->', paragraphs(reflection))
  .replace(
    '<!-- GATES -->',
    gateSummary +
      workspaceSummary +
      '<p>Root test ghi timeout trong auth và 5 ca frontend. Chạy riêng pass 1.297/1.297 backend (timeout 20 giây), 1.687/1.687 frontend (hai worker), 60/60 mobile và 20/20 shared. Root format có khác biệt trên các file ngoài bài. Schema, job service và JWT HTTP trên PostgreSQL pass. Suite export đồng bộ cũ vẫn gặp 503 ở dữ liệu lớn.</p>',
  )
  .replace('<!-- EXECUTION_LOGS -->', excerpts.join(''))
  .replace(
    '<!-- AI_LOG -->',
    table +
      paragraphs(
        usage
          .split(/\r?\n\s*\r?\n/)
          .slice(-2)
          .join('\n\n'),
      ),
  );
const require = createRequire(import.meta.url);
assert.ok(process.env.VT054_PLAYWRIGHT_ROOT);
const { chromium } = require(process.env.VT054_PLAYWRIGHT_ROOT);
await mkdir(resolve(output, '..'), { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({
    path: output,
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate:
      '<div style="width:100%;padding:0 17mm;font:8px Segoe UI;color:#415669;display:flex;justify-content:space-between"><span>SE2026-T13 · VT-054</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  });
} finally {
  await browser.close();
}
