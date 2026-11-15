import { destinationPath, parsePath, type Destination } from './routes';

const listeners = new Set<(destination: Destination) => string | void>();

/** Warm links are delivered synchronously to mounted session guards only. */
export function notifyIncomingLink(
  destination: Destination,
): string | undefined {
  let replacement: string | undefined;
  listeners.forEach((listener) => {
    const handled = listener(destination);
    const path = typeof handled === 'string' ? parsePath(handled) : null;
    if (path) replacement = destinationPath(path);
  });
  return replacement;
}

export function subscribeIncomingLinks(
  listener: (destination: Destination) => string | void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
