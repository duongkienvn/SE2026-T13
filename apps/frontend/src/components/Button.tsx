import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger';
type ButtonSize = 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-primary-solid text-white shadow-card hover:bg-primary-solid-hover disabled:bg-primary-solid/50 dark:disabled:bg-line dark:disabled:text-muted',
  secondary:
    'border border-line bg-surface text-ink hover:bg-app disabled:text-muted',
  danger:
    'bg-danger-solid text-white shadow-card hover:bg-danger-solid/90 disabled:bg-danger-solid/50 dark:disabled:bg-line dark:disabled:text-muted',
};

const sizeClasses: Record<ButtonSize, string> = {
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-5 text-[15px]',
};

/** Button styling, also usable on links that should look like buttons. */
export function buttonClassName(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
): string {
  return `inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed ${sizeClasses[size]} ${variantClasses[variant]}`;
}

export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${buttonClassName(variant, size)} ${className}`}
      {...props}
    />
  );
}
