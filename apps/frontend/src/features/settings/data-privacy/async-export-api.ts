import type { BinaryResponse } from '../../../lib/api-client';
export type ExportPhase = 'queued' | 'running' | 'downloading';
// Test-first contract seam; no workflow behavior exists until RED is recorded.
export async function exportBoardDataAsync(
  _accessToken: string,
  _boardId: string,
  _format: 'json' | 'csv',
  _key: string,
  _signal: AbortSignal,
  _onPhase?: (phase: ExportPhase) => void,
): Promise<BinaryResponse> {
  throw new Error('Async Board export client workflow is not implemented');
}
