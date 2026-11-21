import console from 'node:console';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

/** Closed-loop HTTP workload. Import into the isolated DB fixture to measure
 * real Nest/JWT/SQL/serialization, or run directly against a local test server.
 * No token or full query URL is written to the result.
 */
export async function runSearchLoad({
  endpoint,
  token,
  total = 400,
  expectedTotal,
}) {
  const url = new URL(endpoint);
  const concurrency = 40;
  const target = 1500;
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !token ||
    !Number.isSafeInteger(total) ||
    total < concurrency ||
    (expectedTotal !== undefined &&
      (!Number.isSafeInteger(expectedTotal) || expectedTotal < 0))
  )
    throw new Error(
      'Use a loopback test URL, bearer JWT, requests>=40 and optional nonnegative expected total.',
    );
  const durations = [];
  let next = 0,
    failed = 0,
    active = 0,
    maxActive = 0;
  const started = performance.now();
  async function worker() {
    for (;;) {
      if (next++ >= total) return;
      active++;
      maxActive = Math.max(maxActive, active);
      const start = performance.now();
      try {
        const response = await globalThis.fetch(endpoint, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          signal: globalThis.AbortSignal.timeout(10000),
          cache: 'no-store',
        });
        const body = await response.json();
        const cards = body?.data?.groups?.cards;
        if (
          response.status !== 200 ||
          body?.success !== true ||
          !Array.isArray(cards?.items) ||
          typeof cards.total !== 'number' ||
          typeof cards.hasMore !== 'boolean' ||
          (expectedTotal !== undefined && cards.total !== expectedTotal)
        )
          failed++;
      } catch {
        failed++;
      } finally {
        durations.push(performance.now() - start);
        active--;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const elapsedMs = performance.now() - started;
  durations.sort((a, b) => a - b);
  const percentile = (fraction) =>
    durations[Math.ceil(durations.length * fraction) - 1];
  const round = (value) => Number(value.toFixed(2));
  const p95 = percentile(0.95);
  return {
    kind: 'VT-053 local SEARCH HTTP workload',
    endpoint: url.origin + url.pathname,
    requests: total,
    successful: total - failed,
    failed,
    concurrency,
    maxActive,
    errorRatePercent: round((100 * failed) / total),
    minMs: round(durations[0]),
    p50Ms: round(percentile(0.5)),
    p95Ms: round(p95),
    p99Ms: round(percentile(0.99)),
    maxMs: round(durations.at(-1)),
    elapsedMs: round(elapsedMs),
    requestsPerSecond: round((total * 1000) / elapsedMs),
    targetMs: target,
    expectedTotal,
    meetsTarget: p95 <= target && failed === 0,
    limitation:
      'One local closed-loop run; a synthetic server validates only the harness. Not production capacity evidence.',
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await runSearchLoad({
      endpoint: process.env.VT053_SEARCH_URL,
      token: process.env.VT053_SEARCH_TOKEN,
      total: Number(process.env.VT053_REQUESTS || '400'),
      expectedTotal:
        process.env.VT053_EXPECTED_TOTAL === undefined
          ? undefined
          : Number(process.env.VT053_EXPECTED_TOTAL),
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.meetsTarget) process.exitCode = 1;
  } catch {
    console.error(
      'Set VT053_SEARCH_URL (loopback GET URL), VT053_SEARCH_TOKEN, optional VT053_REQUESTS>=40 and VT053_EXPECTED_TOTAL.',
    );
    process.exitCode = 2;
  }
}
