import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

export interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'children'
> {
  label: string;
  error?: string;
  hint?: string;
  /** Decorative icon rendered inside the input on the left. */
  icon?: ReactNode;
  /** Interactive control rendered inside the input on the right. */
  trailing?: ReactNode;
}

export function TextField({
  label,
  error,
  hint,
  icon,
  trailing,
  className = '',
  ...inputProps
}: TextFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative mt-1.5">
        {icon && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-lg text-muted"
          >
            {icon}
          </span>
        )}
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`h-11 w-full rounded-lg border bg-surface text-sm text-ink transition-colors placeholder:text-muted/80 focus:ring-3 focus:ring-primary/15 focus:outline-none disabled:bg-app disabled:text-muted ${
            error
              ? 'border-danger focus:border-danger'
              : 'border-line focus:border-primary'
          } ${icon ? 'pl-10' : 'pl-3.5'} ${trailing ? 'pr-11' : 'pr-3.5'}`}
          {...inputProps}
        />
        {trailing && (
          <span className="absolute inset-y-0 right-1.5 flex items-center">
            {trailing}
          </span>
        )}
      </div>
      {hint && !error && (
        <p id={hintId} className="mt-1 text-[13px] text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
