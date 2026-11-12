import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHttpClient } from '../../src/infrastructure/api/client.ts';
import { getHealth } from '../../src/infrastructure/api/health.ts';

test('verified health adapter requests raw JSON without bearer and validates its shape', async () => {
  let count = 0;
  const http = createHttpClient({
    baseUrl: new URL('https://example.test/api'),
    fetch: (async (url, init) => {
      count++;
      assert.equal(url, 'https://example.test/health');
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        undefined,
      );
      return new Response(
        JSON.stringify(count === 1 ? { name: 'Kanvexa', status: 'ok' } : {}),
        { headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch,
  });
  assert.deepEqual(await getHealth(http), { name: 'Kanvexa', status: 'ok' });
  await assert.rejects(getHealth(http));
});
