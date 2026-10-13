import type { ReactNode } from 'react';
import { AlertIcon, CheckCircleIcon } from './icons';

interface AlertProps {
  variant: 'error' | 'success';
  children: ReactNode;
}

const variantClasses = {
  error: 'border-danger/30 bg-danger/5 text-ink',
  success: 'border-success/25 bg-success/5 text-ink',
};

/** Inline form-level feedback. Errors are announced assertively, success politely. */
export function Alert({ variant, children }: AlertProps) {
  const Icon = variant === 'error' ? AlertIcon : CheckCircleIcon;

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm ${variantClasses[variant]}`}
    >
      <Icon
        className={`size-5 shrink-0 ${variant === 'error' ? 'text-danger' : 'text-success'}`}
      />
      <div>{children}</div>
    </div>
  );
}
