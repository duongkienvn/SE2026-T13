import type { Destination } from './routes';

const listeners = new Set<(destination: Destination) => void>();

/** Warm links are delivered synchronously to mounted session guards only. */
export function notifyIncomingLink(destination: Destination): void {
  listeners.forEach((listener) => listener(destination));
}

export function subscribeIncomingLinks(
  listener: (destination: Destination) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
