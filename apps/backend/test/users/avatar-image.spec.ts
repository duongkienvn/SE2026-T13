import sharp from 'sharp';
import { AvatarImageService } from '../../src/api/users/avatars/avatar-image.service';
import { AVATAR_MAX_BYTES } from '../../src/api/users/avatars/avatar.constants';

const raster = (width = 640, height = 480) =>
  sharp({ create: { width, height, channels: 3, background: '#6d28d9' } });

describe('AvatarImageService real decoder', () => {
  const images = new AvatarImageService();

  it.each(['jpeg', 'png', 'webp'] as const)(
    'decodes %s bytes and emits bounded metadata-free WebP',
    async (format) => {
      const input = await raster().toFormat(format).toBuffer();
      const output = await images.normalize(input, `image/${format}`);
      const metadata = await sharp(output).metadata();
      expect(metadata).toMatchObject({
        format: 'webp',
        width: 480,
        height: 480,
      });
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.pages ?? 1).toBe(1);
    },
  );

  it('auto-orients pixels and removes EXIF including private metadata', async () => {
    const right = await sharp({
      create: { width: 400, height: 600, channels: 3, background: 'blue' },
    })
      .png()
      .toBuffer();
    const input = await sharp({
      create: { width: 800, height: 600, channels: 3, background: 'red' },
    })
      .composite([{ input: right, left: 400, top: 0 }])
      .withMetadata({ orientation: 6 })
      .withExifMerge({ IFD0: { Artist: 'PRIVATE GPS OWNER' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const output = await images.normalize(input, 'image/jpeg');
    const metadata = await sharp(output).metadata();
    expect(metadata).toMatchObject({ width: 512, height: 512 });
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
    expect(output.includes(Buffer.from('PRIVATE GPS OWNER'))).toBe(false);
    const { data, info } = await sharp(output)
      .raw()
      .toBuffer({ resolveWithObject: true });
    // Orientation 6 rotates the original left/right colors into top/bottom.
    expect(data[(20 * info.width + 256) * info.channels]).toBeGreaterThan(200);
    expect(data[(490 * info.width + 256) * info.channels + 2]).toBeGreaterThan(
      200,
    );
  });

  it.each([
    ['image/png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['image/jpeg', Buffer.from('GIF89a unsupported')],
    ['image/webp', Buffer.from('not an image')],
    ['image/jpeg', Buffer.from([255, 216, 255, 217])],
  ])('rejects unsupported/corrupt bytes labelled %s', async (mime, body) => {
    await expect(images.normalize(body, mime)).rejects.toMatchObject({
      status: 415,
    });
  });

  it('rejects a genuine image with a forged MIME and trailing data', async () => {
    const png = await raster().png().toBuffer();
    await expect(images.normalize(png, 'image/jpeg')).rejects.toMatchObject({
      response: { code: 'AVATAR_MIME_MISMATCH' },
    });
    await expect(
      images.normalize(
        Buffer.concat([png, Buffer.from('payload')]),
        'image/png',
      ),
    ).rejects.toMatchObject({ status: 415 });
  });

  it('rejects oversized input before decoding', async () => {
    await expect(
      images.normalize(Buffer.alloc(AVATAR_MAX_BYTES + 1), 'image/png'),
    ).rejects.toMatchObject({ status: 413 });
  });

  it.each([
    [15, 20],
    [8193, 16],
    [4097, 4097],
  ])('bounds dimensions/decompression for %s x %s', async (width, height) => {
    const input = await raster(width, height).png().toBuffer();
    await expect(images.normalize(input, 'image/png')).rejects.toHaveProperty(
      'status',
    );
  });

  it('rejects a real multi-frame WebP and APNG control chunks', async () => {
    const frame = await raster(32, 32).png().toBuffer();
    const otherFrame = await sharp({
      create: { width: 32, height: 32, channels: 3, background: 'blue' },
    })
      .png()
      .toBuffer();
    const animated = await sharp([frame, otherFrame], {
      join: { animated: true },
    })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(
      2,
    );
    await expect(
      images.normalize(animated, 'image/webp'),
    ).rejects.toMatchObject({
      response: { code: 'AVATAR_UNSUPPORTED_IMAGE' },
    });
    const animationChunk = Buffer.alloc(20);
    animationChunk.writeUInt32BE(8);
    animationChunk.write('acTL', 4);
    const apng = Buffer.concat([
      frame.subarray(0, 33),
      animationChunk,
      frame.subarray(33),
    ]);
    await expect(images.normalize(apng, 'image/png')).rejects.toMatchObject({
      status: 415,
    });
  });
});
