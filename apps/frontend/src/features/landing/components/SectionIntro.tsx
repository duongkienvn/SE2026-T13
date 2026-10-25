import type { ReactNode } from 'react';

/** Eyebrow + h2 + optional lead shared by the landing sections. */
export function SectionIntro({
  titleId,
  eyebrow,
  title,
  children,
  align = 'center',
}: {
  titleId: string;
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  align?: 'center' | 'start';
}) {
  const centered = align === 'center';
  return (
    <div className={centered ? 'mx-auto max-w-2xl text-center' : ''}>
      <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">
        {eyebrow}
      </p>
      <h2
        id={titleId}
        className="mt-3 text-3xl leading-tight font-bold tracking-tight text-ink sm:text-[40px]"
      >
        {title}
      </h2>
      {children && (
        <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">
          {children}
        </p>
      )}
    </div>
  );
}
