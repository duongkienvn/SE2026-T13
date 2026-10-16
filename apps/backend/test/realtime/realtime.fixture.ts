// This declaration is compiled only in tests, never in the backend build.
declare module '@kanban/shared' {
  interface RealtimeServerEvents {
    'test:board': (payload: { sequence: number }) => void;
  }
}
export {};
