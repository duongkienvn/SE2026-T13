import type { ReactNode } from 'react';

interface PageContainerProps {
  children: ReactNode;
  /**
   * Fill the content area's height as a flex column, so a paginated list can
   * take the remaining space and size its pages to fit it.
   */
  fill?: boolean;
}

/** Standard padding for page content inside the application shell. */
export function PageContainer({ children, fill = false }: PageContainerProps) {
  return (
    <div
      className={`px-4 py-5 md:px-6 md:py-6 short:py-4 lg:px-10 ${
        fill ? 'flex h-full flex-col' : ''
      }`}
    >
      {children}
    </div>
  );
}
