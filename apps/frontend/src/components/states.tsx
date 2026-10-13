import type { ReactNode } from 'react';
import { Button } from './Button';
import { AlertIcon, SpinnerIcon } from './icons';

interface LoadingStateProps {
  label?: string;
}

export function LoadingState({ label = 'Loading…' }: LoadingStateProps) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-3 py-16 text-muted"
    >
      <SpinnerIcon className="size-5 animate-spin text-primary" />
      <span className="text-[15px]">{label}</span>
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface/60 px-6 py-16 text-center">
      {icon && (
        <div className="mb-4 grid size-14 place-items-center rounded-full bg-app text-2xl text-muted">
          {icon}
        </div>
      )}
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {description && (
        <p className="mt-1 max-w-sm text-[15px] text-muted">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-xl border border-line bg-surface px-6 py-16 text-center shadow-card"
    >
      <AlertIcon className="mb-3 size-8 text-danger" />
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {description && (
        <p className="mt-1 max-w-sm text-[15px] text-muted">{description}</p>
      )}
      {onRetry && (
        <Button variant="secondary" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
