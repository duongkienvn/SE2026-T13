import type { ComponentType, ReactNode } from 'react';
import { Alert } from '../../../components/Alert';
import {
  DownloadIcon,
  InfoIcon,
  SpinnerIcon,
  type IconProps,
} from '../../../components/icons';
import { Button } from '../../../components/Button';
import type { ExportState } from './useExportDownload';

/** Shared frame of every Data & Privacy card (exports now, Danger Zone in P5-08). */
export const privacyCardClass =
  'rounded-xl border border-line bg-surface p-4 shadow-card md:px-5 short:py-3.5';

interface ExportCardProps {
  id: string;
  title: string;
  description: string;
  icon: ComponentType<IconProps>;
  children: ReactNode;
}

export function ExportCard({
  id,
  title,
  description,
  icon: Icon,
  children,
}: ExportCardProps) {
  return (
    <section aria-labelledby={`${id}-heading`} className={privacyCardClass}>
      <div className="flex gap-3.5 md:gap-4">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary md:size-11"
        >
          <Icon className="size-5.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-heading`} className="text-lg font-semibold text-ink">
            {title}
          </h2>
          <p className="mt-0.5 text-sm text-muted">{description}</p>
        </div>
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

/** A quiet one-line notice with an information icon. */
export function InfoStrip({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`flex items-start gap-2.5 rounded-lg border border-line bg-app px-3.5 py-2.5 text-sm text-muted ${className}`}
    >
      <InfoIcon className="mt-px size-4.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * The export button plus its accessible progress/result status. `beside` is
 * shown before the button and shares its row on wide screens.
 */
export function ExportAction({
  label,
  state,
  disabled,
  onClick,
  beside,
}: {
  label: string;
  state: ExportState;
  disabled?: boolean;
  onClick: () => void;
  beside?: ReactNode;
}) {
  const exporting = state.status === 'exporting';
  return (
    <div className="space-y-3">
      {state.status === 'error' && (
        <Alert variant="error">{state.message}</Alert>
      )}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        {beside}
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
          <Button
            size="lg"
            disabled={disabled || exporting}
            aria-busy={exporting || undefined}
            onClick={onClick}
          >
            {exporting ? (
              <SpinnerIcon className="size-4.5 animate-spin motion-reduce:animate-none" />
            ) : (
              <DownloadIcon className="size-4.5" />
            )}
            {exporting ? 'Preparing export…' : label}
          </Button>
          <p role="status" className="text-sm text-muted">
            {exporting ? (
              <span className="sr-only">
                Preparing your file. This can take a few moments.
              </span>
            ) : state.status === 'saved' ? (
              'Download started.'
            ) : (
              ''
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
