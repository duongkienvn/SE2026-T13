import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { pathToFileURL, URL } from 'node:url';

export async function http(base, path, options = {}) {
  return globalThis.fetch(new URL(path, base), {
    ...options,
    signal: globalThis.AbortSignal.timeout(10_000),
  });
}

export async function smoke(base, token = process.env.SMOKE_ACCESS_TOKEN) {
  const origin = new URL(base).origin;
  const home = await http(origin, '/');
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(home.headers.get('cache-control'), /no-cache/);
  const route = await http(
    origin,
    '/boards/00000000-0000-4000-8000-000000000064',
  );
  assert.equal(route.status, 200);
  assert.equal(await route.text(), html, 'Deep links must return the SPA');
  const asset = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  assert(asset, 'Vite entry asset is missing');
  const script = await http(origin, asset);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('cache-control'), /immutable/);
  const bundle = await script.text();
  assert(bundle.includes('/api'));
  assert(!bundle.includes('http://localhost:3000'));
  assert.equal(
    (await http(origin, '/assets/nonexistent-issue64.js')).status,
    404,
  );
  const health = await http(origin, '/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
  const ready = await http(origin, '/health/ready');
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).database, 'ok');
  const api = await http(origin, '/api/users/me');
  assert.equal(api.status, 401);
  assert.equal(
    (await api.json()).success,
    false,
    'REST request must reach NestJS',
  );
  const docs = await http(origin, '/api-docs-json');
  assert(
    !docs.headers.get('content-type')?.includes('application/json'),
    'Swagger must stay disabled',
  );
  // Engine.IO's canonical transport path ends in '/'. The exact no-slash path
  // must still reach NestJS (JSON 404), rather than being rewritten to the SPA.
  const exactSocketPath = await http(origin, '/socket.io');
  assert.equal(exactSocketPath.status, 404);
  assert(
    exactSocketPath.headers.get('content-type')?.includes('application/json'),
  );
  for (const pathname of ['/socket.io/']) {
    const polling = await http(origin, `${pathname}?EIO=4&transport=polling`, {
      headers: { Origin: origin },
    });
    assert.equal(polling.status, 200);
    assert.match(await polling.text(), /^0\{"sid":/);
  }
  assert.equal(
    (
      await http(origin, '/socket.io/?EIO=4&transport=polling', {
        headers: { Origin: 'https://untrusted.example' },
      })
    ).status,
    403,
  );

  await new Promise((resolve, reject) => {
    const url = new URL('/socket.io/?EIO=4&transport=websocket', origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new globalThis.WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket handshake timed out'));
    }, 10_000);
    const finish = (error) => {
      clearTimeout(timer);
      ws.close();
      if (error) reject(error);
      else resolve();
    };
    ws.addEventListener(
      'error',
      () => finish(new Error('WebSocket transport failed')),
      { once: true },
    );
    ws.addEventListener('message', (event) => {
      const packet = String(event.data);
      if (packet.startsWith('0{'))
        ws.send(`40${JSON.stringify(token ? { accessToken: token } : {})}`);
      else if (token && packet.startsWith('40{')) finish();
      else if (!token && packet.startsWith('44')) finish();
      else if (token && packet.startsWith('44'))
        finish(new Error('Socket.IO rejected the smoke token'));
      else if (packet === '2') ws.send('3');
    });
  });
  console.log(
    `PASS ${origin}: SPA, assets, REST, liveness, database readiness, CORS, polling and ${token ? 'authenticated' : 'unauthenticated rejection over'} WebSocket`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  assert(
    process.argv[2],
    'Usage: node scripts/deployment/smoke.mjs https://kanvexa.tech',
  );
  await smoke(process.argv[2]);
}
