import { vi } from 'vitest';

/** An unsigned JWT-shaped token whose payload carries `sub` (the user id). */
export function tokenFor(sub: string): string {
  const payload = btoa(JSON.stringify({ sub }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

/** Stubs `matchMedia` with a dark-mode query the test can flip. */
export function stubColorScheme(initiallyDark: boolean) {
  let dark = initiallyDark;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query.includes('dark') ? dark : false;
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) =>
      listeners.delete(listener),
  }));
  return {
    setDark(next: boolean) {
      dark = next;
      listeners.forEach((listener) => listener());
    },
  };
}
