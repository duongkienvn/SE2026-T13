import { ConfigService } from '@nestjs/config';
import { HttpExpoPushProvider } from '../../src/api/push/expo-push.provider';
describe('Expo HTTPS boundary', () => {
  it('distinguishes definitive receipt rejection from receipt lookup outage', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            ticket: {
              status: 'error',
              details: { error: 'MessageRateExceeded' },
            },
          },
        }),
      ),
    );
    expect(await provider().receipt('ticket')).toEqual({
      type: 'rejected',
      code: 'PROVIDER_UNAVAILABLE',
    });
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    expect(await provider().receipt('ticket')).toEqual({
      type: 'retry',
      code: 'PROVIDER_UNAVAILABLE',
    });
  });
  const provider = () =>
    new HttpExpoPushProvider(
      new ConfigService({ EXPO_PUSH_ACCESS_TOKEN: 'server-only-secret' }),
    );
  afterEach(() => jest.restoreAllMocks());
  it('sends only generic content and stores a ticket, not delivered success', async () => {
    const call = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ status: 'ok', id: 'ticket-123' }] }),
        ),
      );
    expect(
      await provider().send(
        'ExpoPushToken[abcdefghijklmnop]',
        '14f2550e-9359-4c06-a642-6257cb384b53',
      ),
    ).toEqual({ type: 'ticket', ticketId: 'ticket-123' });
    const options = call.mock.calls[0][1]!;
    expect(JSON.parse(options.body as string)).toEqual([
      {
        to: 'ExpoPushToken[abcdefghijklmnop]',
        title: 'Kanvexa',
        body: 'You have a new notification',
        data: { notificationId: '14f2550e-9359-4c06-a642-6257cb384b53' },
        channelId: 'kanvexa',
        ttl: 3600,
      },
    ]);
    expect(options.headers).toMatchObject({
      Authorization: 'Bearer server-only-secret',
    });
  });
  it.each([429, 500, 503])(
    'retries definitive HTTP %i rejection',
    async (status) => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('', { status }));
      expect(await provider().send('token', 'id')).toEqual({
        type: 'retry',
        code: 'PROVIDER_UNAVAILABLE',
      });
    },
  );
  it('never retries a broken connection or malformed success', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('secret token'));
    expect(await provider().send('token', 'id')).toEqual({
      type: 'unknown',
      code: 'SEND_UNCERTAIN',
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    expect(await provider().send('token', 'id')).toEqual({
      type: 'unknown',
      code: 'SEND_UNCERTAIN',
    });
  });
  it('treats an actual request abort as unknown send, but allows receipt lookup retry', async () => {
    const deadlines: AbortController[] = [];
    const timeout = jest
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation((ms) => {
        expect(ms).toBe(10_000);
        const controller = new AbortController();
        deadlines.push(controller);
        return controller.signal;
      });
    const call = jest.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener(
            'abort',
            () => reject(new Error('private timeout details')),
            { once: true },
          );
        }),
    );
    const sending = provider().send(
      'ExpoPushToken[abcdefghijklmnop]',
      'notification-id',
    );
    deadlines[0].abort();
    expect(await sending).toEqual({ type: 'unknown', code: 'SEND_UNCERTAIN' });
    const lookup = provider().receipt('accepted-ticket');
    deadlines[1].abort();
    expect(await lookup).toEqual({
      type: 'retry',
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(timeout).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });
  it('bounds response bytes and never replays an uncertain oversized or broken body', async () => {
    const call = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('x'.repeat(128_001)));
    expect(await provider().send('token', 'id')).toEqual({
      type: 'unknown',
      code: 'SEND_UNCERTAIN',
    });
    call.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('private body error'));
          },
        }),
      ),
    );
    expect(await provider().send('token', 'id')).toEqual({
      type: 'unknown',
      code: 'SEND_UNCERTAIN',
    });
    expect(call).toHaveBeenCalledTimes(2);
  });
  it('revokes DeviceNotRegistered and distinguishes accepted receipts', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              status: 'error',
              details: { error: 'DeviceNotRegistered' },
              message: 'private',
            },
          ],
        }),
      ),
    );
    expect(await provider().send('token', 'id')).toEqual({
      type: 'permanent',
      code: 'DEVICE_NOT_REGISTERED',
    });
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { ticket: { status: 'ok' } } })),
      );
    expect(await provider().receipt('ticket')).toEqual({ type: 'accepted' });
  });
  it('keeps missing receipts pending and redacts credentials failures', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: {} })));
    expect(await provider().receipt('ticket')).toEqual({ type: 'pending' });
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 401 }));
    expect(await provider().send('token', 'id')).toEqual({
      type: 'permanent',
      code: 'PROVIDER_CREDENTIALS',
    });
  });
});
