import { useId } from 'react';
import { SearchIcon } from './icons';

interface SearchFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/** Toolbar search input (boards.png). The label is visually hidden. */
export function SearchField({
  label,
  value,
  onChange,
  placeholder,
  className = '',
}: SearchFieldProps) {
  const id = useId();
  return (
    <div className={`relative ${className}`}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted"
      />
      <input
        id={id}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-lg border border-line bg-surface pr-4 pl-12 text-[15px] text-ink placeholder:text-muted/80 focus:border-primary focus:ring-3 focus:ring-primary/15 focus:outline-none"
      />
    </div>
  );
}
