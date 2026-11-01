import sharp from 'sharp';
import { AttachmentContentService } from '../../src/api/cards/attachments/attachment-content.service';

function pdf(extra = '', stream?: string): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] ${extra} ${stream === undefined ? '' : '/Contents 4 0 R'} >>`,
  ];
  if (stream !== undefined)
    objects.push(
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  return classicPdf(objects);
}

function classicPdf(objects: string[]): Buffer {
  let text = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text));
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    text += `${String(offset).padStart(10, '0')} 00000 n \n`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}
// No /EmbeddedFiles name tree: the page annotation reaches a binary stream directly.
function embeddedPdf(encoded = false): Buffer {
  const name = (value: string) =>
    '/' +
    (encoded
      ? [...value].map((char) => '#' + char.charCodeAt(0).toString(16)).join('')
      : value);
  const payload = 'MZ\0\x01synthetic binary fixture';
  return classicPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Annots [4 0 R] >>',
    `<< /Type /Annot /Subtype ${name('FileAttachment')} /Rect [0 0 10 10] /FS 5 0 R >>`,
    `<< /Type ${name('Filespec')} /F (payload.bin) ${name('EF')} << /F 6 0 R >> >>`,
    `<< /Type ${name('EmbeddedFile')} /Length ${Buffer.byteLength(payload)} >>\nstream\n${payload}\nendstream`,
  ]);
}

describe('actual attachment content verification', () => {
  const verifier = new AttachmentContentService(),
    budget = 10 * 1024 * 1024;
  it.each(['png', 'jpeg', 'webp'] as const)(
    'fully decodes and re-encodes %s without source metadata',
    async (format) => {
      const builder = sharp({
        create: { width: 32, height: 20, channels: 3, background: '#123456' },
      }).withMetadata({ orientation: 6 });
      const source = await builder[format]().toBuffer();
      const output = await verifier.verify(source, `image/${format}`, budget);
      const metadata = await sharp(output).metadata();
      expect(metadata.format).toBe(format);
      expect(metadata.exif).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();
      expect(metadata.width).toBe(20);
      expect(metadata.height).toBe(32);
    },
  );
  it('rejects mismatched, truncated, trailing polyglot and corrupt raster containers', async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    for (const body of [
      png.subarray(0, -1),
      Buffer.concat([png, Buffer.from('<html>evil')]),
      Buffer.from('<svg onload="alert(1)"></svg>'),
    ])
      await expect(
        verifier.verify(body, 'image/png', budget),
      ).rejects.toMatchObject({ status: 415 });
    const corrupt = Buffer.from(png);
    corrupt[20] ^= 1;
    await expect(
      verifier.verify(corrupt, 'image/png', budget),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      verifier.verify(png, 'image/jpeg', budget),
    ).rejects.toMatchObject({ status: 415 });
    await expect(verifier.verify(png, 'image/png', 1)).rejects.toMatchObject({
      status: 413,
    });
  });
  it('bounds decoded dimensions, pixels and concurrent native processing', async () => {
    const wide = await sharp({
      create: { width: 8193, height: 1, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    await expect(
      verifier.verify(wide, 'image/png', budget),
    ).rejects.toMatchObject({ status: 422 });
    const normal = await sharp({
      create: { width: 16, height: 16, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    const jobs = await Promise.allSettled([
      verifier.verify(normal, 'image/png', budget),
      verifier.verify(normal, 'image/png', budget),
      verifier.verify(normal, 'image/png', budget),
    ]);
    expect(jobs.filter((row) => row.status === 'fulfilled')).toHaveLength(2);
    expect(jobs.find((row) => row.status === 'rejected')).toMatchObject({
      reason: { status: 503 },
    });
  });
  it('accepts UTF-8 text while rejecting binary, malformed encoding and obvious active content', async () => {
    const text = Buffer.from('Résumé\nHello\tworld\r\n');
    expect(await verifier.verify(text, 'text/plain', text.length)).toEqual(
      text,
    );
    for (const body of [
      Buffer.from([0xff, 0xfe, 65, 0]),
      Buffer.from('hello\0'),
      Buffer.from('<html><script>bad</script>'),
      Buffer.from('#!/bin/sh\nrm x'),
      Buffer.from('alert(1)'),
      Buffer.from('<svg/>'),
    ])
      await expect(
        verifier.verify(body, 'text/plain', budget),
      ).rejects.toMatchObject({ status: 415 });
    await expect(
      verifier.verify(Buffer.alloc(budget + 1), 'text/plain', budget),
    ).rejects.toMatchObject({ status: 413 });
  });
  it('verifies classic PDF xref offsets, catalog/page tree and exact stream lengths', async () => {
    for (const body of [pdf(), pdf('', 'q\nQ')])
      expect(
        await verifier.verify(body, 'application/pdf', body.length),
      ).toEqual(body);
    for (const body of [
      Buffer.from('%PDF-1.4\nnot a PDF'),
      pdf().subarray(0, -10),
      Buffer.concat([pdf(), Buffer.from('<html>')]),
      Buffer.from(pdf('', 'q\nQ').toString().replace('/Length 3', '/Length 9')),
      Buffer.from(pdf().toString().replace('/Count 1', '/Count 2')),
      Buffer.from(
        pdf().toString().replace('<< /Type /Catalog', '   /Type /Catalog'),
      ),
    ])
      await expect(
        verifier.verify(body, 'application/pdf', budget),
      ).rejects.toThrow();
  });
  it.each([false, true])(
    'rejects a classic-xref attachment annotation and embedded binary without a name tree (escaped=%s)',
    async (encoded) => {
      const body = embeddedPdf(encoded);
      expect(body.toString('latin1')).not.toContain('/EmbeddedFiles');
      await expect(
        verifier.verify(body, 'application/pdf', budget),
      ).rejects.toMatchObject({ status: 415 });
    },
  );
  it.each([
    'FileAttachment',
    'Filespec',
    'EF',
    'EmbeddedFile',
    'EmbeddedFiles',
  ])(
    'rejects the PDF attachment name /%s independently, including name escapes',
    async (name) => {
      // Build xref offsets after encoding, so rejection cannot be caused by broken structure.
      for (const spelling of [
        name,
        '#' + name.charCodeAt(0).toString(16) + name.slice(1),
        [...name]
          .map((char) => '#' + char.charCodeAt(0).toString(16).toUpperCase())
          .join(''),
      ]) {
        await expect(
          verifier.verify(
            pdf('/' + spelling + ' null'),
            'application/pdf',
            budget,
          ),
        ).rejects.toMatchObject({ status: 415 });
      }
    },
  );
  it.each([
    '/JavaScript (evil)',
    '/#4A#53 (evil)',
    '/Launch (evil)',
    '/Encrypt (secret)',
    '/ObjStm (hidden)',
    '/EmbeddedFiles (payload)',
  ])('rejects active/encrypted/hidden PDF feature %s', async (feature) => {
    await expect(
      verifier.verify(pdf(feature), 'application/pdf', budget),
    ).rejects.toMatchObject({ status: 415 });
  });
});
