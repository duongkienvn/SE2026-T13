import { ConfigService } from '@nestjs/config';
import { HttpExpoPushProvider } from '../../src/api/push/expo-push.provider';
describe('Expo HTTPS boundary', () => {
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
  it('revokes DeviceNotRegistered and distinguishes accepted receipts', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
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
