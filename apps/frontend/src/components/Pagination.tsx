import { useMediaQuery } from '../hooks/useMediaQuery';
import { pageNumbers } from '../lib/pagination';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';

interface PaginationProps {
  /** Names what is paged, e.g. "Boards pages". */
  label: string;
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  className?: string;
}

const itemClass =
  'grid h-8 min-w-8 place-items-center rounded-lg px-1.5 text-sm font-medium sm:h-9 sm:min-w-9 sm:px-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** Numbered page buttons (1 … 4 5 6 … 12) with previous/next. Hidden for one page. */
export function Pagination({
  label,
  page,
  pageCount,
  onChange,
  className = '',
}: PaginationProps) {
  // Phones get fewer numbers (1 … 5 … 11) so the row never wraps.
  const wide = useMediaQuery('(min-width: 480px)', true);
  if (pageCount <= 1) return null;

  return (
    <nav aria-label={label} className={className}>
      <ul className="flex flex-wrap items-center justify-center sm:gap-1">
        <li>
          <button
            type="button"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onChange(page - 1)}
            className={`${itemClass} text-muted hover:bg-surface hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`}
          >
            <ChevronLeftIcon aria-hidden="true" className="size-4" />
          </button>
        </li>
        {pageNumbers(page, pageCount, wide ? 1 : 0).map((number, index) =>
          number === null ? (
            <li
              key={`gap-${index}`}
              aria-hidden="true"
              className="px-1 text-sm text-muted"
            >
              …
            </li>
          ) : (
            <li key={number}>
              <button
                type="button"
                aria-label={`Page ${number}`}
                aria-current={number === page ? 'page' : undefined}
                onClick={() => onChange(number)}
                className={`${itemClass} ${
                  number === page
                    ? 'bg-primary-solid text-white shadow-card'
                    : 'text-ink hover:bg-surface'
                }`}
              >
                {number}
              </button>
            </li>
          ),
        )}
        <li>
          <button
            type="button"
            aria-label="Next page"
            disabled={page >= pageCount}
            onClick={() => onChange(page + 1)}
            className={`${itemClass} text-muted hover:bg-surface hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`}
          >
            <ChevronRightIcon aria-hidden="true" className="size-4" />
          </button>
        </li>
      </ul>
    </nav>
  );
}
