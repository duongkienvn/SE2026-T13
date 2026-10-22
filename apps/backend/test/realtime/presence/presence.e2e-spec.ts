import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('Board presence through real Socket.IO and AppModule', () => {
  it('covers authorization, snapshots, tabs, expiry, reconnect and committed revocation', () => {
    const output = execFileSync(
      process.execPath,
      [
        '-r',
        require.resolve('ts-node/register'),
        'test/realtime/presence/presence.bootstrap.mjs',
      ],
      {
        cwd: resolve(__dirname, '../../..'),
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
    expect(output).toContain('Presence Socket.IO: 8 groups PASS');
  }, 65_000);
});
