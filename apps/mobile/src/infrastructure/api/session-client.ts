import { partialMatchKey } from '@tanstack/react-query';
import { keyBelongsTo, type PrivateQueryKey } from '../query/keys.ts';
import type { ResourceAccess } from '../query/resource-access.ts';
import type {
  BinaryResult,
  Decoder,
  Envelope,
  HttpClient,
  RequestOptions,
} from './client.ts';
import { ApiError } from './errors.ts';
import type { SessionManager } from '../auth/session-manager.ts';

/** Token-free identity for caches, pending work and MOB-06 callbacks. */
export interface SessionIdentity {
  readonly userId: string;
  readonly generation: number;
}
export type SessionRequestOptions = Omit<RequestOptions, 'accessToken'> & {
  readonly identity?: SessionIdentity;
  /** Bind resource HTTP work to the same key used by its query/mutation. */
  readonly resourceKey?: PrivateQueryKey;
};
export interface SessionHttpClient {
  envelope<T>(
    path: string,
    decode: Decoder<T>,
    options?: SessionRequestOptions,
  ): Promise<Envelope<T>>;
  json<T>(
    path: string,
    decode: Decoder<T>,
    options?: SessionRequestOptions,
  ): Promise<T>;
  rawJson<T>(
    path: string,
    decode: Decoder<T>,
    options?: SessionRequestOptions,
  ): Promise<T>;
  empty(path: string, options?: SessionRequestOptions): Promise<void>;
  text(
    path: string,
    contentTypes: readonly string[],
    options?: SessionRequestOptions,
  ): Promise<string>;
  binary(
    path: string,
    contentTypes: readonly string[],
    options?: SessionRequestOptions,
  ): Promise<BinaryResult>;
}

export function currentIdentity(
  manager: SessionManager,
): SessionIdentity | null {
  // This checks absolute expiry and may synchronously end the session.
  const credential = manager.getAccessCredential();
  const snapshot = manager.getSnapshot();
  return credential &&
    snapshot.status === 'authenticated' &&
    credential.generation === snapshot.generation
    ? { userId: snapshot.user.id, generation: snapshot.generation }
    : null;
}

export function sameIdentity(
  a: SessionIdentity | null,
  b: SessionIdentity | null,
): boolean {
  return (
    a !== null &&
    b !== null &&
    a.userId === b.userId &&
    a.generation === b.generation
  );
}

export function createSessionHttpClient(
  http: HttpClient,
  manager: SessionManager,
  resources?: ResourceAccess,
) {
  const pending = new Map<AbortController, PrivateQueryKey | undefined>();
  let disposed = false;
  function cancelRequests() {
    for (const controller of pending.keys()) controller.abort();
    pending.clear();
  }
  const unbind = manager.addLifecycleListener({ onSessionEnd: cancelRequests });

  async function run<T>(
    options: SessionRequestOptions = {},
    operation: (options: RequestOptions) => Promise<T>,
  ): Promise<T> {
    if (disposed) throw new ApiError('session-changed');
    const identity = currentIdentity(manager);
    if (!identity) throw new ApiError('unauthenticated');
    if (options.identity && !sameIdentity(identity, options.identity))
      throw new ApiError('session-changed');
    const credential = manager.getAccessCredential();
    if (!credential || !sameIdentity(identity, currentIdentity(manager)))
      throw new ApiError('session-changed');
    if (options.resourceKey && !keyBelongsTo(options.resourceKey, identity))
      throw new ApiError('session-changed');
    const resourceCurrent = options.resourceKey
      ? resources?.capture(
          options.resourceKey,
          (options.method ?? 'GET') !== 'GET',
        )
      : undefined;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) cancel();
    pending.set(controller, options.resourceKey);
    try {
      const value = await operation({
        ...options,
        accessToken: credential.accessToken,
        signal: controller.signal,
      });
      if (disposed || !sameIdentity(identity, currentIdentity(manager)))
        throw new ApiError('session-changed');
      resourceCurrent?.();
      return value;
    } catch (error) {
      if (disposed || !sameIdentity(identity, currentIdentity(manager)))
        throw new ApiError('session-changed');
      if (
        error instanceof ApiError &&
        [403, 404].includes(error.status) &&
        options.resourceKey
      )
        resources?.denied(options.resourceKey);
      if (error instanceof ApiError && error.status === 401)
        manager.handleUnauthorized(identity.generation);
      else if (!(
        error instanceof ApiError && [403, 404].includes(error.status)
      ))
        resourceCurrent?.();
      throw error;
    } finally {
      pending.delete(controller);
      options.signal?.removeEventListener('abort', cancel);
    }
  }
  const client: SessionHttpClient = {
    json: (path, decode, options) =>
      run(options, (next) => http.json(path, decode, next)),
    envelope: (path, decode, options) =>
      run(options, (next) => http.envelope(path, decode, next)),
    rawJson: (path, decode, options) =>
      run(options, (next) => http.rawJson(path, decode, next)),
    empty: (path, options) => run(options, (next) => http.empty(path, next)),
    text: (path, types, options) =>
      run(options, (next) => http.text(path, types, next)),
    binary: (path, types, options) =>
      run(options, (next) => http.binary(path, types, next)),
  };
  return {
    client,
    cancelRequests,
    cancelResourceRequests(key: PrivateQueryKey) {
      for (const [controller, resourceKey] of pending)
        if (resourceKey && partialMatchKey(resourceKey, key))
          controller.abort();
    },
    dispose() {
      disposed = true;
      cancelRequests();
      unbind();
    },
  };
}
