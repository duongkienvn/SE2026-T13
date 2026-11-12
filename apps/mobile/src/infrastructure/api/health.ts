import type { HttpClient } from './client.ts';

/** HealthController + HealthResponseDto; this endpoint bypasses the envelope. */
export interface HealthStatus {
  readonly name: string;
  readonly status: string;
}

export function getHealth(
  http: HttpClient,
  signal?: AbortSignal,
): Promise<HealthStatus> {
  return http.rawJson(
    '/health',
    (value) => {
      if (
        !value ||
        typeof value !== 'object' ||
        !('name' in value) ||
        typeof value.name !== 'string' ||
        !('status' in value) ||
        typeof value.status !== 'string'
      )
        throw new Error('Invalid health');
      return { name: value.name, status: value.status };
    },
    { signal, expectedStatus: 200 },
  );
}
