import { createContext } from 'react';
import type { BoardRealtimeClient } from './board-realtime-client';

/** The signed-in session's realtime client; `null` while signed out. */
export const RealtimeContext = createContext<BoardRealtimeClient | null>(null);
