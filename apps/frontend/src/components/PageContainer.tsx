import type { ReactNode } from 'react';

interface PageContainerProps {
  children: ReactNode;
}

/** Standard padding for page content inside the application shell. */
export function PageContainer({ children }: PageContainerProps) {
  return <div className="px-4 py-6 md:px-8 md:py-8 lg:px-14">{children}</div>;
}
