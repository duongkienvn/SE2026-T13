import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest runs from the frontend package. Its jsdom import.meta.url is HTTP,
// so resolve filesystem fixtures from the package directory instead.
const publicAsset = (path: string) => resolve('public', path.slice(1));

describe('public brand assets', () => {
  const head = new DOMParser().parseFromString(
    readFileSync(resolve('index.html'), 'utf8'),
    'text/html',
  ).head;

  it('provides Kanvexa metadata and existing browser icon files', () => {
    expect(head.querySelector('title')?.textContent).toContain('Kanvexa');
    expect(
      head
        .querySelector('meta[name="application-name"]')
        ?.getAttribute('content'),
    ).toBe('Kanvexa');
    expect(
      head.querySelector('meta[name="description"]')?.getAttribute('content'),
    ).toContain('Kanban boards');
    const links = head.querySelectorAll(
      'link[rel="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]',
    );
    expect(links.length).toBe(4);
    for (const link of links) {
      expect(existsSync(publicAsset(link.getAttribute('href')!))).toBe(true);
    }
    const manifest = JSON.parse(
      readFileSync(publicAsset('/site.webmanifest'), 'utf8'),
    );
    expect(manifest.name).toBe('Kanvexa');
    for (const icon of manifest.icons) {
      expect(existsSync(publicAsset(icon.src))).toBe(true);
    }
  });

  it('serves the official transparent artwork without changing pixels or colors', () => {
    const served = readFileSync(publicAsset('/branding/kanvexa-logo-v1.png'));
    // Pin the approved public artwork without depending on temporary sources.
    expect(createHash('sha256').update(served).digest('hex')).toBe(
      '9dcb6593a1edef473753ffd36f2939a8035740fa46cc36faba9b7f661af3587f',
    );
    expect(served.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(served.readUInt32BE(16)).toBe(1024);
    expect(served.readUInt32BE(20)).toBe(1024);
    expect(served[25]).toBe(6); // PNG RGBA, retaining the alpha channel.
  });
});
