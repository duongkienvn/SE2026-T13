import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('Board business events through REST and real Socket.IO', () => {
  it('delivers all seventeen minimal contracts with isolation, no-ops and revocation', () => {
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
        timeout: 100_000,
      },
    );
    expect(output).toContain('9 groups PASS');
  }, 105_000);
});
