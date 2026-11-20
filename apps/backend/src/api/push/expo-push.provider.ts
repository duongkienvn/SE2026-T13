import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '../../config/environment';
export type PushErrorCode =
  | 'DEVICE_NOT_REGISTERED'
  | 'MESSAGE_INVALID'
  | 'PROVIDER_CREDENTIALS'
  | 'PROVIDER_UNAVAILABLE'
  | 'SEND_UNCERTAIN';
export type SendResult =
  | { type: 'ticket'; ticketId: string }
  | { type: 'retry' | 'permanent' | 'unknown'; code: PushErrorCode };
export type ReceiptResult =
  | { type: 'accepted' | 'pending' }
  | { type: 'rejected'; code: PushErrorCode }
  | { type: 'retry' | 'permanent'; code: PushErrorCode };
export abstract class ExpoPushProvider {
  abstract send(token: string, notificationId: string): Promise<SendResult>;
  abstract receipt(ticketId: string): Promise<ReceiptResult>;
}
type ProviderItem = {
  status?: string;
  id?: unknown;
  details?: { error?: unknown };
};
function failure(item: ProviderItem): {
  type: 'retry' | 'permanent';
  code: PushErrorCode;
} {
  switch (item.details?.error) {
    case 'DeviceNotRegistered':
      return { type: 'permanent', code: 'DEVICE_NOT_REGISTERED' };
    case 'MessageRateExceeded':
      return { type: 'retry', code: 'PROVIDER_UNAVAILABLE' };
    case 'InvalidCredentials':
    case 'MismatchSenderId':
      return { type: 'permanent', code: 'PROVIDER_CREDENTIALS' };
    default:
      return { type: 'permanent', code: 'MESSAGE_INVALID' };
  }
}
/** Fixed HTTPS endpoints, bounded responses/timeouts. No provider messages escape. */
@Injectable()
export class HttpExpoPushProvider extends ExpoPushProvider {
  constructor(private readonly config: ConfigService<EnvironmentConfig, true>) {
    super();
  }
  private async request(path: 'send' | 'getReceipts', body: unknown) {
    const access = this.config.get('EXPO_PUSH_ACCESS_TOKEN', { infer: true });
    const response = await fetch('https://exp.host/--/api/v2/push/' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(access ? { Authorization: 'Bearer ' + access } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { status: response.status, data: undefined as unknown };
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty provider response');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 128_000) throw new Error('Provider response too large');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return {
      status: response.status,
      data: JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        data?: unknown;
      },
    };
  }
  async send(token: string, notificationId: string): Promise<SendResult> {
    try {
      const result = await this.request('send', [
        {
          to: token,
          title: 'Kanvexa',
          body: 'You have a new notification',
          data: { notificationId },
          channelId: 'kanvexa',
          ttl: 3600,
        },
      ]);
      if (result.status === 429 || result.status >= 500)
        return { type: 'retry', code: 'PROVIDER_UNAVAILABLE' };
      if (result.status === 401 || result.status === 403)
        return { type: 'permanent', code: 'PROVIDER_CREDENTIALS' };
      if (result.status >= 400)
        return { type: 'permanent', code: 'MESSAGE_INVALID' };
      const data = (result.data as { data?: unknown })?.data;
      const item =
        Array.isArray(data) && data.length === 1
          ? (data[0] as ProviderItem)
          : undefined;
      if (
        item?.status === 'ok' &&
        typeof item.id === 'string' &&
        /^[A-Za-z0-9_-]{1,100}$/.test(item.id)
      )
        return { type: 'ticket', ticketId: item.id };
      if (item?.status === 'error') return failure(item);
      return { type: 'unknown', code: 'SEND_UNCERTAIN' };
    } catch {
      return { type: 'unknown', code: 'SEND_UNCERTAIN' };
    }
  }
  async receipt(ticketId: string): Promise<ReceiptResult> {
    try {
      const result = await this.request('getReceipts', { ids: [ticketId] });
      if (result.status === 401 || result.status === 403)
        return { type: 'permanent', code: 'PROVIDER_CREDENTIALS' };
      if (result.status >= 400)
        return { type: 'retry', code: 'PROVIDER_UNAVAILABLE' };
      const item = (result.data as { data?: Record<string, ProviderItem> })
        ?.data?.[ticketId];
      if (item?.status === 'ok') return { type: 'accepted' };
      if (item?.status === 'error') {
        const result = failure(item);
        return result.type === 'retry'
          ? { type: 'rejected', code: result.code }
          : result;
      }
      return { type: 'pending' };
    } catch {
      return { type: 'retry', code: 'PROVIDER_UNAVAILABLE' };
    }
  }
}
