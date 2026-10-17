import type { BoardRealtime } from '../useBoardRealtime';

/**
 * A quiet pill shown only while live updates are interrupted; the board
 * itself stays usable through REST either way.
 */
export function RealtimeStatus({ status, retry }: BoardRealtime) {
  if (status !== 'reconnecting' && status !== 'paused') return null;
  const paused = status === 'paused';

  return (
    <span
      role="status"
      className="inline-flex h-6 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-[13px] font-medium text-muted"
    >
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${paused ? 'bg-muted' : 'animate-pulse bg-brand-soft'}`}
      />
      {paused ? 'Live updates paused' : 'Reconnecting…'}
      {paused && (
        <button
          type="button"
          onClick={retry}
          className="rounded font-semibold text-primary hover:text-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Retry
        </button>
      )}
    </span>
  );
}
