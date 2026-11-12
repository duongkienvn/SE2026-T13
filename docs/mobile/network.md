# Mobile REST and Query foundation (MOB-04)

The app root owns one `nativeSession` and `nativeData`, constructed before secure
restore begins. `AuthSessionProvider → DataProvider → NavigationRoot` preserves
the existing SecureStore manager, route guards, safe areas and status bar.
`useMobileData()` exposes the layer to features. No feature UI or socket connection
is introduced here.

## Verified contracts

| Operation               | Source and behavior                                                                                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/users/me`     | `UsersController`, `UserResponseDto`: bearer, 200 success envelope. The mobile decoder keeps the existing `SessionUser` identity projection and rejects deleted/malformed users. No shared full User DTO exists. |
| `POST /api/auth/logout` | `AuthController`: bearer, 204, stateless acknowledgement. Best effort after local teardown; no retry or refresh endpoint.                                                                                        |
| `GET /health`           | `HealthController`, `HealthResponseDto`, `http-application.ts`: public raw JSON `{ name, status }`, excluded from the API prefix. `getHealth(transport)` explicitly selects the same-origin root.                |
| Ordinary JSON           | `ApiResponseInterceptor`: shared `ApiSuccessResponse<T>`, optional page/cursor metadata; `GlobalExceptionFilter`: shared `ApiErrorResponse`.                                                                     |
| Downloads               | `ExportsController`: raw JSON/CSV bytes, status 200, attachment disposition. Exports bypass the envelope. MOB-04 exposes transport support, not export UI or speculative resource adapters.                      |

Backend source is authoritative. Issue #248 originally allowed a mock-only session
port; this implementation also integrates the subsequently merged MOB-05/MOB-03
interfaces as requested. Historical mobile roadmap dependency ordering and the
MOB-01-only development introduction do not describe this checkout's full behavior.

## Public configuration and native transport

Set `EXPO_PUBLIC_API_BASE_URL` to a reachable API prefix, for example
`http://10.0.2.2:3000/api` for the Android Studio emulator's host machine. A physical
device needs the development machine's private LAN IPv4, the same network, a
listening backend and a suitable local firewall rule. Device `localhost` refers
to the device. Native OS cleartext restrictions still apply; prefer development
HTTPS where available. Do not weaken release network security settings.

HTTPS is mandatory outside development. Even development permits HTTP only on
loopback, Android emulator host or private LAN addresses. Configuration and the
transport both validate URLs; credentials, query strings and fragments are
forbidden in base URLs. There is no production fallback. Missing/invalid config
sends no traffic and keeps stored credentials unverified. All `EXPO_PUBLIC_*`
values are public build input; never put tokens or secrets there. Socket config
remains unused by MOB-04. No production requests are required for verification.

`createHttpClient` accepts injected fetch, clock, timers and connectivity for tests.
Use the session-bound `nativeData.api` for protected features. Only bootstrap
verification/logout use an explicit bearer. Public health uses the underlying
transport without authentication. Custom Authorization/Cookie overrides are
rejected, cookies are omitted, and requests use no-store and redirect-error policy.
API-relative paths cannot escape the configured origin/prefix; encode each resource
ID with `encodeURIComponent`. Query values use URL encoding, repeated array values,
sorted parameter names and omitted null/undefined values.

| Method                                | Result and validation                                                                                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `json(path, decode, options)`         | Unwrap a validated envelope and runtime-decode `data`. Empty/malformed successful JSON, wrong content type/status or error envelopes reject.                                                                                   |
| `envelope(path, decode, options)`     | Retain shared success fields and validated page/cursor metadata. Use `requirePage` when a page is mandatory.                                                                                                                   |
| `rawJson(path, decode, options)`      | Decode explicitly unwrapped JSON, such as health. Reject an error envelope.                                                                                                                                                    |
| `empty(path, options)`                | Require exactly 204. JSON endpoints never silently turn empty 200/201 responses into success.                                                                                                                                  |
| `text(path, contentTypes, options)`   | Explicit MIME allowlist; JSON cannot accidentally take this path.                                                                                                                                                              |
| `binary(path, contentTypes, options)` | Return in-memory ArrayBuffer bytes and untrusted disposition metadata after status/MIME checks. JSON downloads require attachment disposition and valid non-envelope JSON. Never writes files or assumes browser File support. |

Downloads are currently buffered; large/streamed transfer and saving/sharing files
need a scoped native adapter and consent flow in the feature issue. Never use the
raw Content-Disposition header directly as a filename/path. Uploads supply a
`NativeUpload` factory (`kind: 'native-upload', createBody()`) returning FormData
with strings, Blobs or bytes-backed Expo File parts. Raw React Native
`{ uri, name, type }` parts are rejected before fetch: SDK 58 installs `expo/fetch`
by default, and its multipart converter does not support those legacy parts.
Use `createNativeMultipartUpload` from `infrastructure/api/native-upload.ts` for
local `file:`/`content:` picker URIs. It opens them with `expo-file-system` File and
forwards its bytes reader while retaining optional filename/MIME overrides and
ordinary/repeated string fields. Expo fetch owns the multipart boundary and body
conversion, inside the request's cancellation/deadline. Files must remain readable
for the operation. Uploads and other mutations execute once. See
[Expo's native fetch contract](https://docs.expo.dev/versions/v58.0.0/sdk/expo/#expofetch-api)
and [File/FormData uploads](https://docs.expo.dev/versions/v58.0.0/sdk/filesystem/#uploading-files-using-expofetch).

The default 15-second deadline covers fetch, body consumption and retry waits;
per-request deadlines must be positive and at most 120 seconds. AbortSignal works
before send, during fetch/body reading and during backoff, even if injected fetch
ignores cancellation. Errors are `ApiError`: HTTP status/code/safe message/details,
request ID and Retry-After, or configuration, invalid-response, unauthenticated,
session-changed, timeout, aborted, offline and network kinds. Arbitrary HTML/native
exceptions, URLs, bodies and tokens are not retained or logged. Offline is asserted
only with connectivity evidence; a fetch rejection alone means network failure.

Only GET retries: one retry by default, configurable to zero or two, on network
failure or 429/500/502/503/504. Backoff is 250/500 ms unless Retry-After supplies a
seconds/date delay. Delays above five seconds or invalid server policy stop
automatic retry; callers can present manual retry using the retained policy.
The total deadline still applies. No automatic POST/PATCH/PUT/DELETE replay.

## Session and cache boundary

`currentIdentity(manager)` returns token-free `{ userId, generation }` only for a
verified, unexpired session. The bound transport obtains a fresh credential for
each operation and checks identity before and after the operation. Pass the
captured identity into query/mutation requests: an old query closure cannot send
using a new account's bearer. A matching 401 calls MOB-05's generation-safe
`handleUnauthorized`; 403/404 do not sign out. Offline-uncertain remains distinct.

Session-end hooks abort protected requests/uploads, cancel and remove private
queries and clear mutation state synchronously before the next identity publishes.
Late responses and rollback/reconciliation callbacks cannot restore old-account
data. All private keys start with `['mobile', 'private', userId, generation]`.
The verified session user seeds the current-user query, avoiding an immediate
duplicate `/users/me` after restore/login. Later invalidation is authoritative.

`queryKeys` covers current user, Workspace lists/detail, Board lists/detail,
Board-scoped Card lists/detail and notifications/count. Keys are cache identities,
not endpoint wrappers or permission grants. Put filters/page/limit/cursor in their
filter object. Plain-object keys sort deterministically, undefined fields are
omitted, array order and opaque cursor values are preserved. Normalize set-valued
filters in the future source-verified feature adapter before constructing keys.

Queries have 30-second stale time, five-minute GC, stale active refetch on focus
and reconnect, and no additional retry layer. Mutations have no retries and use
`networkMode: 'always'` to report offline rather than queue writes. Native AppState
checks expiry before enabling focus; Expo Network feeds onlineManager and session
reverification after onlineManager has been marked online. Initial asynchronous
connectivity cannot overwrite a newer event.
Follow the [TanStack native integration](https://tanstack.com/query/v5/docs/framework/react/react-native)
and [cancellation contract](https://tanstack.com/query/v5/docs/framework/react/guides/query-cancellation).

```ts
const identity = data.getIdentity(); // data = useMobileData() or nativeData
if (!identity) return; // no protected query until session verification succeeds
await data.queryClient.fetchQuery(data.meOptions(identity));
// React queryFns must forward TanStack's signal and captured identity to data.api.
```

`nextPage`/`nextCursor` consume server metadata. Fetch only requested pages; avoid
eager whole-Board walks. `deduplicatePages` preserves first-seen server order and
uses later overlapping values. No persistent private cache or offline write queue.

`data.invalidate(identity, keys)` validates session/key scope, batches hints in one
microtask and matches overlapping targets once. Active queries refetch; inactive
queries become stale. Refetches supersede older active reads so the resulting
snapshot is authoritative. Count actual fetches, not just invalidation calls.

`data.optimistic({ identity, key, update, mutation, reconcile?, invalidate? })`
serializes edits of the same exact key, cancels its read, snapshots data and applies
an optimistic patch. On error it rolls back only its own unchanged query revision;
newer authoritative data wins. On settlement it queues invalidation of affected keys
without waiting for the read: the write promise and same-key lock settle immediately.
The next edit can cancel that read and trigger its own authoritative refresh.
Refetch rejection is handled asynchronously and never fails a committed write.
Optional reconcile uses the server result. Session changes or eviction fence late reconciliation.
Use `data.api` with the captured identity inside `mutation`; never store credentials
in mutation variables. Domain-specific conflict/reorder behavior still belongs to
the feature's tests. Queries for unrelated resources are not blocked.

## MOB-06 integration

MOB-06 owns socket lifecycle, board receive grants, event coalescing across ticks,
and mapping verified server events to affected resources. It should:

1. Obtain identity via `data.getIdentity()` and bearer via the existing manager's
   `getAccessCredential()` at each connect. Capture identity in every callback.
2. Disconnect on session end; use `data.assertCurrent(identity)` or compare the
   current identity before processing events. Session teardown already invokes
   `data.resetPrivateState()`; do not register a second cache owner.
3. Use the same exported keys for Board/Card/notification invalidation. Example:

   ```ts
   await data.invalidate(identity, [
     queryKeys.card(identity, boardId, cardId),
     queryKeys.cards(identity, boardId),
   ]);
   ```

   Empty filters in `cards()` are a partial key matching every filter/page for
   that Board. Backend authorization remains mandatory on refetch; the cache
   coordinator does not infer Board membership from Workspace roles.

4. On access loss call `data.evict(identity, affectedKeys)` immediately, including
   relevant lists/previews and notifications, then rerun verified access reads.
   Eviction synchronously cancels/removes matching queries. Every queryFn must
   forward its signal. For broader loss, `data.cancelRequests()` aborts all bound
   HTTP operations; `data.resetPrivateState()` also clears protected cache.
   MOB-06 must revoke its receive grant and prevent new unauthorized observers
   from mounting; eviction alone is not a grant registry.
5. Use `data.recover(identity)` for missed-event recovery after socket reconnect.
   It marks that session stale and refetches active observers once per batch.
   Native network/focus already handle stale recovery; coordinate overlapping
   socket hints at the feature/resource boundary instead of repeatedly calling
   broad recovery for every event. Catch stale-generation rejection and ignore it.
6. Dispose the data layer before its session manager when replacing the app runtime
   in tests or host teardown. Ordinary screens never dispose app-lifetime owners.

No Socket.IO connection, new event contract, backend migration, refresh token or
complete feature screen is part of MOB-04.
