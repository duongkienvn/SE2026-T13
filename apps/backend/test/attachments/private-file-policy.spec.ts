import { validateAttachmentEnvironment } from '../../src/api/cards/attachments/attachment.config';
import {
  validateAttachmentDeclaration,
  safeAttachmentFilename,
  attachmentDisposition,
} from '../../src/api/cards/attachments/attachment-file-policy';

describe('private attachment configuration and V1 policy', () => {
  it('defaults disabled and prevents production memory or inherited test S3', () => {
    expect(validateAttachmentEnvironment({}).ATTACHMENT_STORAGE_DRIVER).toBe(
      'disabled',
    );
    expect(() =>
      validateAttachmentEnvironment({
        NODE_ENV: 'production',
        ATTACHMENT_STORAGE_DRIVER: 'memory',
      }),
    ).toThrow();
    expect(
      validateAttachmentEnvironment({
        NODE_ENV: 'test',
        ATTACHMENT_STORAGE_DRIVER: 's3',
      }).ATTACHMENT_STORAGE_DRIVER,
    ).toBe('disabled');
  });
  it('requires acknowledgement, isolated bucket and safe backend settings', () => {
    const base = {
      ATTACHMENT_STORAGE_DRIVER: 's3',
      ATTACHMENT_S3_BUCKET: 'private-card-files',
      ATTACHMENT_POLICY_ACK: 'v1',
    };
    expect(validateAttachmentEnvironment(base).ATTACHMENT_STORAGE_DRIVER).toBe(
      's3',
    );
    for (const extra of [
      { ATTACHMENT_POLICY_ACK: '' },
      { AVATAR_S3_BUCKET: 'private-card-files' },
      { ATTACHMENT_S3_PREFIX: '../avatars' },
      { ATTACHMENT_S3_BUCKET: '127.0.0.1' },
      { ATTACHMENT_S3_REGION: 'bad' },
      { ATTACHMENT_S3_ENDPOINT: 'http://local' },
      { ATTACHMENT_ACCESS_KEY_ID: 'secret' },
    ])
      expect(() =>
        validateAttachmentEnvironment({ ...base, ...extra }),
      ).toThrow();
  });
  it('enforces exact types, extensions, bytes and prospective raster reservations', () => {
    expect(
      validateAttachmentDeclaration('notes.txt', 'text/plain', 100)
        .reservedBytes,
    ).toBe(100);
    expect(
      validateAttachmentDeclaration('photo.PNG', 'image/png', 100)
        .reservedBytes,
    ).toBe(10 * 1024 * 1024);
    for (const [name, mime, size] of [
      ['x.svg', 'image/svg+xml', 100],
      ['x.html', 'text/plain', 100],
      ['x.exe', 'application/pdf', 100],
      ['x.txt', 'text/plain', 0],
      ['x.txt', 'text/plain', 10 * 1024 * 1024 + 1],
    ])
      expect(() => validateAttachmentDeclaration(name, mime, size)).toThrow();
  });
  it('sanitizes Unicode filenames and produces injection-safe download headers', () => {
    expect(safeAttachmentFilename(' résumé?.txt ')).toBe('résumé_.txt');
    for (const name of [
      '../x.txt',
      'x\\a.txt',
      'a\r\nX: a.txt',
      'x\u202Etxt.pdf',
      '...',
      '／a.txt',
    ])
      expect(() => safeAttachmentFilename(name)).toThrow();
    expect(attachmentDisposition('résumé.txt', 'text/plain')).toContain(
      "filename*=UTF-8''r%C3%A9sum%C3%A9.txt",
    );
    expect(attachmentDisposition('photo.png', 'image/png')).toMatch(/^inline;/);
  });
});
