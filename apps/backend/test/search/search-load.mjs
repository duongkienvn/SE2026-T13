import { performance } from 'node:perf_hooks';
import process from 'node:process';

const endpoint = process.env.VT053_SEARCH_URL;
const token = process.env.VT053_SEARCH_TOKEN;
const concurrency = 40;
const total = Number(process.env.VT053_REQUESTS || '400');
const target = 1500;
if (!endpoint || !token || !/^https?:\/\//.test(endpoint) || !Number.isSafeInteger(total) || total < concurrency) {
  console.error('Set VT053_SEARCH_URL (full GET URL), VT053_SEARCH_TOKEN (bearer JWT), optional VT053_REQUESTS>=40.');
  process.exit(2);
}
const durations = [];
let next = 0, failed = 0, active = 0, maxActive = 0;
async function worker() {
  for (;;) {
    const i = next++;
    if (i >= total) return;
    active++;
    maxActive = Math.max(maxActive, active);
    const start = performance.now();
    try {
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
        cache: 'no-store',
      });
      const body = await response.json();
      if (response.status !== 200 || body?.success !== true || !body?.data?.groups) failed++;
    } catch {
      failed++;
    } finally {
      durations.push(performance.now() - start);
      active--;
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));
durations.sort((a, b) => a - b);
const p95 = durations[Math.ceil(durations.length * .95) - 1];
const output = {
  kind: 'VT-053 SEARCH HTTP workload',
  endpoint: new URL(endpoint).origin + new URL(endpoint).pathname,
  requests: total, concurrency, maxActive,
  p95Ms: Number(p95.toFixed(2)), targetMs: target,
  failed, errorRate: Number((100 * failed / total).toFixed(2)),
  meetsTarget: p95 <= target && failed === 0,
  warning: 'A synthetic server validates the harness only; it does not validate production database latency.'
};
console.log(JSON.stringify(output, null, 2));
if (!output.meetsTarget) process.exitCode = 1;
