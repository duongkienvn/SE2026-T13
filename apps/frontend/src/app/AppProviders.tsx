import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { AuthProvider } from '../features/auth/AuthProvider';
import { RealtimeProvider } from '../features/realtime/RealtimeProvider';
import { ThemeSync } from '../features/settings/ThemeSync';
import { createQueryClient } from '../lib/query-client';

interface AppProvidersProps {
  children: ReactNode;
}

/** Application-level providers. */
export function AppProviders({ children }: AppProvidersProps) {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeSync />
        <RealtimeProvider>{children}</RealtimeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
