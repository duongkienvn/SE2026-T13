import {
  toExportJobResponse,
  canRetryExportJob,
  type ExportJobRecord,
} from './export-job-policy';

const now = new Date('2026-11-12T12:00:00Z');
const base: ExportJobRecord = {
  id: '4da6b7b2-61b7-4890-acb9-0a2538030044',
  state: 'PENDING',
  format: 'json',
  attempts: 0,
  expiresAt: new Date(now.getTime() + 900_000),
};

describe('VT-054 export job public contract', () => {
  test.each([
    ['PENDING', 0],
    ['RUNNING', null],
    ['COMPLETED', 100],
    ['FAILED', null],
  ] as const)(
    'TC08/09: maps %s without inventing percentage progress',
    (state, progress) => {
      const result = toExportJobResponse({ ...base, state });
      expect(result).toEqual({
        id: base.id,
        state,
        format: 'json',
        attempts: 0,
        progress,
        error: state === 'FAILED' ? 'EXPORT_FAILED' : null,
        expiresAt: base.expiresAt.toISOString(),
      });
    },
  );

  it('TC09: exposes exactly the allowlist even when private job columns are present', () => {
    const row = {
      ...base,
      state: 'FAILED' as const,
      body: Buffer.from('PRIVATE'),
      idempotencyKey: 'PRIVATE_KEY',
      leaseToken: 'PRIVATE_LEASE',
      internalError: 'SELECT password_hash FROM users',
    };
    const result = toExportJobResponse(row);
    expect(Object.keys(result).sort()).toEqual(
      [
        'id',
        'state',
        'format',
        'attempts',
        'progress',
        'error',
        'expiresAt',
      ].sort(),
    );
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SELECT|password_hash/);
    expect(result.error).toBe('EXPORT_FAILED');
  });

  it('TC12: preserves the requested CSV representation in the response', () => {
    expect(toExportJobResponse({ ...base, format: 'csv' }).format).toBe('csv');
  });
});

describe('VT-054 explicit retry eligibility', () => {
  test.each(['PENDING', 'RUNNING', 'COMPLETED'] as const)(
    'TC02: replay does not restart %s jobs',
    (state) => {
      expect(canRetryExportJob({ ...base, state }, now)).toBe(false);
    },
  );
  it('TC10: permits failed attempts below the fixed attempt limit', () => {
    expect(
      canRetryExportJob({ ...base, state: 'FAILED', attempts: 1 }, now),
    ).toBe(true);
    expect(
      canRetryExportJob({ ...base, state: 'FAILED', attempts: 2 }, now),
    ).toBe(true);
  });
  it('TC10: refuses exhausted failures without resetting attempt count', () => {
    expect(
      canRetryExportJob({ ...base, state: 'FAILED', attempts: 3 }, now),
    ).toBe(false);
  });
  it('TC13: refuses an expired failure at and after the deadline', () => {
    const row = { ...base, state: 'FAILED' as const, attempts: 1 };
    expect(canRetryExportJob(row, base.expiresAt)).toBe(false);
    expect(canRetryExportJob(row, new Date(base.expiresAt.getTime() + 1))).toBe(
      false,
    );
  });
});
