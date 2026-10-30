// Deliberate-bug harness for VT-052: invert one true/false business rule at a
// time, run the card suites and restore the source. Run from apps/backend:
//   node test/cards/cards-import.mutants.mjs [mutantId ...]
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const SERVICE = 'src/api/cards/cards.service.ts';
const IMPORT = 'src/api/cards/cards-import.ts';

const MUTANTS = [
  {
    id: 'M1',
    rule: 'only valid rows are ACCEPTED',
    file: IMPORT,
    from: 'if (isValid) accepted.push',
    to: 'if (!isValid) accepted.push',
  },
  {
    id: 'M2',
    rule: 'imported cards enter the ACTIVE state',
    file: SERVICE,
    from: "          isArchived: false,\n          archivedAt: null,\n          position: '0.0000000000',",
    to: "          isArchived: true,\n          archivedAt: null,\n          position: '0.0000000000',",
  },
  {
    id: 'M3',
    rule: 'import appends after the last ACTIVE card (archived cards ignored)',
    file: SERVICE,
    from: "      const last = await cards.findOne({\n        where: { boardId, columnId: column.id, isArchived: false },\n        order: { position: 'DESC', id: 'DESC' },\n      });\n      let previous",
    to: "      const last = await cards.findOne({\n        where: { boardId, columnId: column.id, isArchived: true },\n        order: { position: 'DESC', id: 'DESC' },\n      });\n      let previous",
  },
  {
    id: 'M3b',
    rule: 'supplementary: drop the ACTIVE filter from the append lookup',
    file: SERVICE,
    from: "      const last = await cards.findOne({\n        where: { boardId, columnId: column.id, isArchived: false },\n        order: { position: 'DESC', id: 'DESC' },\n      });\n      let previous",
    to: "      const last = await cards.findOne({\n        where: { boardId, columnId: column.id },\n        order: { position: 'DESC', id: 'DESC' },\n      });\n      let previous",
  },
  {
    id: 'M4',
    rule: 'archived boards are read-only (shared mutate guard, old behaviour)',
    file: SERVICE,
    from: '        { mutable: true },',
    to: '        { mutable: false },',
  },
  {
    id: 'M5',
    rule: 'overflowing append triggers one rebalance',
    file: SERVICE,
    from: '          overflow = true;',
    to: '          overflow = false;',
  },
];

const suites = process.env.MUTANT_SUITES ?? 'test/cards';
const selected = process.argv.slice(2);
const results = [];
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

for (const mutant of MUTANTS.filter(
  (m) => !selected.length || selected.includes(m.id),
)) {
  const original = readFileSync(mutant.file, 'utf8');
  const source = original.replace(/\r\n/g, '\n');
  const occurrences = source.split(mutant.from).length - 1;
  if (occurrences !== 1)
    throw new Error(`${mutant.id}: expected 1 match, found ${occurrences}`);
  try {
    writeFileSync(mutant.file, source.replace(mutant.from, mutant.to));
    const run = spawnSync('npx', ['jest', '--runInBand', '--silent', suites], {
      encoding: 'utf8',
      shell: true,
    });
    const output = `${run.stdout}\n${run.stderr}`.replace(ANSI, '');
    const killers = [...output.matchAll(/● (.+?) › (.+)$/gm)].map((match) =>
      match[2].trim(),
    );
    const summary = /Tests:\s+(.+)$/m.exec(output)?.[1] ?? 'no summary';
    results.push({
      id: mutant.id,
      rule: mutant.rule,
      status: run.status === 0 ? 'SURVIVED' : 'KILLED',
      summary,
      killers: [...new Set(killers)],
    });
  } finally {
    writeFileSync(mutant.file, original);
  }
}

for (const result of results) {
  console.log(`${result.id} ${result.status} — ${result.rule}`);
  console.log(`   ${result.summary}`);
  for (const killer of result.killers) console.log(`   killed by: ${killer}`);
}
process.exitCode = results.some((r) => r.status === 'SURVIVED') ? 1 : 0;
