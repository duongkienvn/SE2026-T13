import { useId, type TextareaHTMLAttributes } from 'react';

interface TextAreaFieldProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'id'
> {
  label: string;
  error?: string;
  hint?: string;
}

/** Multi-line counterpart of TextField with the same label/hint/error wiring. */
export function TextAreaField({
  label,
  error,
  hint,
  className = '',
  rows = 4,
  ...props
}: TextAreaFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`mt-1.5 block w-full resize-y rounded-lg border bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted/80 focus:ring-3 focus:ring-primary/15 focus:outline-none disabled:resize-none disabled:bg-app disabled:text-muted ${
          error
            ? 'border-danger focus:border-danger'
            : 'border-line focus:border-primary'
        }`}
        {...props}
      />
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
