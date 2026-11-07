import type { ComponentType, ReactNode } from 'react';
import type { IconProps } from '../../../components/icons';

/** The approved narrow Security column; both cards share its width. */
export const securityCardClass =
  'mt-3 max-w-2xl rounded-xl border border-line bg-surface px-4 py-3.5 shadow-card md:px-5';

/** Icon tile, title and one-line description at the top of a Security card. */
export function SecurityCardHeader({
  id,
  title,
  description,
  icon: Icon,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  icon: ComponentType<IconProps>;
  children?: ReactNode;
}) {
  return (
    <div className="flex gap-3.5">
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id={id} className="text-lg font-semibold text-ink">
          {title}
        </h2>
        {description && (
          <p className="mt-0.5 text-sm text-muted">{description}</p>
        )}
        {children}
      </div>
    </div>
  );
}
