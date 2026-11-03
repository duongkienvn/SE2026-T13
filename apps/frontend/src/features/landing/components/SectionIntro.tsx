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
      <p className="landing-eyebrow">{eyebrow}</p>
      <h2 id={titleId} className="landing-section-title">
        {title}
      </h2>
      {children && <p className="landing-section-lead">{children}</p>}
    </div>
  );
}
