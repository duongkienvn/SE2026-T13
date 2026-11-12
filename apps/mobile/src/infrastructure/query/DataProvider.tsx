import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';
import { QueryClientProvider } from '@tanstack/react-query';
import { useSessionManager } from '../auth/SessionProvider';
import type { MobileDataLayer } from './data-layer.ts';
import { bindQueryLifecycle } from './lifecycle.ts';

const DataContext = createContext<MobileDataLayer | null>(null);
export function DataProvider({
  layer,
  children,
}: {
  layer: MobileDataLayer;
  children: ReactNode;
}) {
  const manager = useSessionManager();
  useEffect(() => bindQueryLifecycle(manager, AppState, Network), [manager]);
  return (
    <DataContext.Provider value={layer}>
      <QueryClientProvider client={layer.queryClient}>
        {children}
      </QueryClientProvider>
    </DataContext.Provider>
  );
}
export function useMobileData(): MobileDataLayer {
  const layer = useContext(DataContext);
  if (!layer) throw new Error('useMobileData needs a DataProvider');
  return layer;
}
