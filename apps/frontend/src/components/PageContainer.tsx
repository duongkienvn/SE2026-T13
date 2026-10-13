import type { ReactNode } from 'react';

interface PageContainerProps {
  children: ReactNode;
}

/** Standard padding for page content inside the application shell. */
export function PageContainer({ children }: PageContainerProps) {
  return (
    <div className="px-4 py-5 md:px-6 md:py-6 short:py-4 lg:px-10">
      {children}
    </div>
  );
}
