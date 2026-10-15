import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('Socket.IO through real AppModule, JWT and REST', () => {
  it('covers authentication, rooms, broadcast isolation, expiration and concurrent REST revocation', () => {
    const output = execFileSync(
      process.execPath,
      [
        '-r',
        require.resolve('ts-node/register'),
        'test/realtime.bootstrap.mjs',
      ],
      { cwd: resolve(__dirname, '..'), encoding: 'utf8', timeout: 60_000 },
    );
    expect(output).toContain('14 scenarios PASS');
  }, 65_000);
});
