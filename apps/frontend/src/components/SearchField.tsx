import { useId } from 'react';
import { SearchIcon } from './icons';

interface SearchFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  describedBy?: string;
}

/** Toolbar search input (boards.png). The label is visually hidden. */
export function SearchField({
  label,
  value,
  onChange,
  placeholder,
  className = '',
  disabled = false,
  describedBy,
}: SearchFieldProps) {
  const id = useId();
  return (
    <div className={`relative ${className}`}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-muted"
      />
      <input
        id={id}
        type="search"
        disabled={disabled}
        aria-describedby={describedBy}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-line bg-surface pr-3.5 pl-10 text-sm text-ink placeholder:text-muted/80 focus:border-primary focus:ring-3 focus:ring-primary/15 focus:outline-none disabled:cursor-not-allowed disabled:bg-app disabled:text-muted"
      />
    </div>
  );
}
