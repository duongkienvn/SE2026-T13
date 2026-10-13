import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('real BoardsModule and AuthModule dependency wiring', () => {
  it('bootstraps the complete Nest application outside Jest ESM mocks', () => {
    const output = execFileSync(
      process.execPath,
      [
        '-r',
        require.resolve('ts-node/register'),
        'test/boards-module.bootstrap.mjs',
      ],
      { cwd: resolve(__dirname, '..'), encoding: 'utf8', timeout: 45_000 },
    );
    expect(output).toContain('protected routes: PASS');
  }, 50_000);
});
