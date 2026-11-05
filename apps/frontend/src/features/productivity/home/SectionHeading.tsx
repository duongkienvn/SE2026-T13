import type { ReactNode } from 'react';
import type { IconProps } from '../../../components/icons';

/** Home-only panel heading; action links and pagers keep their existing behavior. */
export function SectionHeading({
  id,
  title,
  description,
  Icon,
  children,
}: {
  id: string;
  title: string;
  description: string;
  Icon: (props: IconProps) => React.JSX.Element;
  children: ReactNode;
}) {
  return (
    <div className="home-section-head">
      <span className="home-section-icon" aria-hidden="true">
        <Icon className={id === 'home-starred' ? 'fill-current' : undefined} />
      </span>
      <div className="home-section-heading">
        <h2 id={id}>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="home-section-actions">{children}</div>
    </div>
  );
}
