import { performance } from 'node:perf_hooks';
import { createJobModel } from './job-model.mjs';

// Controlled fake: 10 ms timer, no database, HTTP, export data or network.
const model = createJobModel(
  () => new Promise((resolve) => setTimeout(resolve, 10)),
);
const measure = async (index) => {
  const start = performance.now();
  const { id } = model.submit(
    'synthetic-user',
    `key-${index}`,
    `board-${index}`,
  );
  for (;;) {
    const { status } = model.status('synthetic-user', id);
    if (status === 'COMPLETED' || status === 'FAILED')
      return { ms: performance.now() - start, status };
    await new Promise((resolve) => setImmediate(resolve));
  }
};
const results = await Promise.all(
  Array.from({ length: 120 }, (_, index) => measure(index)),
);
const latencies = results.map(({ ms }) => ms).sort((a, b) => a - b);
const percentile = (p) => latencies[Math.ceil(p * latencies.length) - 1];
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      workload:
        'one synthetic user, 120 distinct jobs, each fake exporter waits 10 ms',
      latency: 'submit through observed terminal status',
      operations: results.length,
      errors: results.filter(({ status }) => status !== 'COMPLETED').length,
      p50_ms: percentile(0.5),
      p95_ms: percentile(0.95),
      target_ms: 3500,
      production_verified: false,
    },
    null,
    2,
  ),
);
