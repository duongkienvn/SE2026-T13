import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  normalizeAttachmentUrl,
  attachmentDisplayName,
} from '../../src/api/cards/attachments/attachment-url';
import {
  CreateAttachmentDto,
  UpdateAttachmentDto,
} from '../../src/api/cards/dto/attachment-requests.dto';
import { toAttachmentResponse } from '../../src/api/cards/dto/attachment-response.dto';
import { CardAttachment } from '../../src/api/cards/entities/card-attachment.entity';

describe('attachment syntax and safe contracts', () => {
  it('normalizes HTTPS syntactically without resolving or fetching targets', () => {
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('No outbound I/O'));
    try {
      expect(
        normalizeAttachmentUrl('HTTPS://Example.COM:443/a/../doc?q=1#part'),
      ).toBe('https://example.com/doc?q=1#part');
      expect(normalizeAttachmentUrl('https://例え.テスト/doc')).toContain(
        'xn--',
      );
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
  it.each([
    'http://example.com',
    'javascript:alert(1)',
    'data:text/html,x',
    'file:///tmp/x',
    '//example.com',
    'https:example.com',
    'https://user:pass@example.com',
    'https://@example.com',
    'https://example.com\\evil',
    'https://example.com/\n',
    'https://example.com/%0d%0aHeader',
    'https://',
    'https://example.com:99999',
    'https://example.com/' + 'x'.repeat(2048),
    null,
    1,
  ])('rejects unsafe/malformed URL %p', (value) => {
    expect(() => normalizeAttachmentUrl(value)).toThrow();
  });
  it('bounds normalized URL length, display name and defaults', () => {
    expect(attachmentDisplayName(undefined, 'https://example.com/')).toBe(
      'example.com',
    );
    expect(attachmentDisplayName(' Name ', 'https://example.com/')).toBe(
      'Name',
    );
    for (const value of ['', ' ', 'a'.repeat(121), 'a\u0000b', null])
      expect(() =>
        attachmentDisplayName(value, 'https://example.com/'),
      ).toThrow();
    expect(() =>
      normalizeAttachmentUrl(
        'https://' + '例'.repeat(60) + '.com/' + 'a'.repeat(1970),
      ),
    ).toThrow();
  });
  it('validates discriminated creation and revisioned partial updates', async () => {
    const errors = async (type: new () => object, input: object) =>
      validate(plainToInstance(type, input), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
    expect(
      await errors(CreateAttachmentDto, {
        kind: 'URL',
        url: 'https://example.com',
      }),
    ).toHaveLength(0);
    expect(await errors(CreateAttachmentDto, { kind: 'FILE' })).toHaveLength(0);
    for (const input of [
      { kind: 'URL' },
      { kind: 'URL', url: 'data:text/plain,x' },
      { kind: 'URL', url: 'https://example.com', storageKey: 'secret' },
      { kind: 'URL', url: null },
    ])
      expect((await errors(CreateAttachmentDto, input)).length).toBeGreaterThan(
        0,
      );
    expect(
      await errors(UpdateAttachmentDto, {
        expectedRevision: 1,
        displayName: 'New',
      }),
    ).toHaveLength(0);
    for (const input of [
      { displayName: 'New' },
      { expectedRevision: 0 },
      { expectedRevision: 1, url: null },
      { expectedRevision: 1, kind: 'FILE' },
    ])
      expect((await errors(UpdateAttachmentDto, input)).length).toBeGreaterThan(
        0,
      );
  });
  it('never serializes storage/intent fields or unfinished rows', () => {
    const row = Object.assign(new CardAttachment(), {
      id: 'id',
      state: 'ACTIVE',
      kind: 'URL',
      url: 'https://example.com/',
      byteSize: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      storageKey: 'secret',
      pendingKey: 'secret',
      requestedMimeType: 'secret',
      reservedBytes: '1',
      requestHash: 'secret',
      expiresAt: new Date(0),
    });
    expect(JSON.stringify(toAttachmentResponse(row))).not.toContain('secret');
    row.state = 'PENDING';
    expect(() => toAttachmentResponse(row)).toThrow();
  });
});
