import type { CardDueStatus } from '@kanban/shared';
import {
  dueFilterSignature,
  nextDueInstantDelay,
} from '../preferences/temporal';
import { useTemporalReconciler } from '../preferences/useTemporalReconciler';

/**
 * Shared Kanban/Table due clock: re-renders badges at loaded due instants and
 * reconciles an active server due-status filter only when time can change it.
 */
export function useDueReconciler({
  cards,
  dueStatus,
  timeZone,
  fetchedAt,
  active,
  onDueBoundary,
}: {
  cards: readonly { dueDate: string | null }[];
  dueStatus?: CardDueStatus;
  timeZone?: string;
  fetchedAt?: number;
  active: boolean;
  onDueBoundary?: () => void;
}) {
  // Server classification uses saved preferences; UTC is the documented fallback.
  const zone = timeZone ?? 'UTC';
  return useTemporalReconciler({
    active,
    fetchedAt: onDueBoundary ? fetchedAt : undefined,
    signature: (at) => dueFilterSignature(cards, dueStatus, zone, at),
    onStale: onDueBoundary,
    wakeDelay: (now) => nextDueInstantDelay(cards, now),
  });
}
