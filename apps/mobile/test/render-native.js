import React from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/ui';

export const phoneMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 24, right: 0, bottom: 24, left: 0 },
};

export function renderNative(
  element,
  { theme = 'light', metrics = phoneMetrics } = {},
) {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeContext.Provider value={theme}>{element}</ThemeContext.Provider>
    </SafeAreaProvider>,
  );
}
