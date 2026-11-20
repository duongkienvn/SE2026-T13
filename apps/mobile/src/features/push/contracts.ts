import type {
  CurrentPushDevice,
  PushPreferences,
  RegisterPushDevice,
} from '@kanban/shared';
export type Permission = 'granted' | 'denied' | 'undetermined';
export type Capability =
  'ready' | 'needs-build' | 'unavailable' | 'setup-required';
export interface PushNative {
  capability(): Capability;
  permission(prompt: boolean): Promise<Permission>;
  token(): Promise<string>;
  listen(
    received: (data: unknown) => void,
    tapped: (data: unknown) => void,
    tokenChanged: () => void,
  ): Promise<() => void>;
  clearResponse(): Promise<void>;
}
export interface PushApi {
  get(signal: AbortSignal): Promise<PushPreferences>;
  patch(enabled: boolean, signal: AbortSignal): Promise<PushPreferences>;
  register(input: RegisterPushDevice, signal: AbortSignal): Promise<void>;
  current(
    installationId: string,
    signal: AbortSignal,
  ): Promise<CurrentPushDevice>;
  remove(installationId: string, signal: AbortSignal): Promise<void>;
}
export const uuid4 = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
export function pushNotificationId(data: unknown) {
  const id =
    data && typeof data === 'object'
      ? (data as Record<string, unknown>).notificationId
      : null;
  return uuid4(id) ? id.toLowerCase() : null;
}
