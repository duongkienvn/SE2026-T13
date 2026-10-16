import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('Board business events through REST and real Socket.IO', () => {
  it('delivers all twelve minimal contracts with isolation, no-ops and revocation', () => {
    const output = execFileSync(
      process.execPath,
      [
        '-r',
        require.resolve('ts-node/register'),
        'test/realtime/board-events/board-events.bootstrap.mjs',
      ],
      {
        cwd: resolve(__dirname, '../../..'),
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
    expect(output).toContain('7 groups PASS');
  }, 65_000);
});
