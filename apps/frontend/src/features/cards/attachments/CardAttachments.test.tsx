import { fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { okPage } from '../../../test/board-fixtures';
import {
  openCardDetail,
  writes,
  type Handler,
} from '../../../test/card-detail-fixtures';
import { fail, ok, type MockResponse } from '../../../test/mock-api';
import type { Card } from '../types';
import { env } from '../../../lib/env';
import { transferFile, type Attachment } from './api';
import { safeHttpsUrl } from './CardAttachments';

const stamp = '2026-10-31T00:00:00.000Z';
function attachment(card: Card, overrides: Partial<Attachment>): Attachment {
  return {
    id: 'att-1',
    boardId: card.boardId,
    cardId: card.id,
    uploaderId: 'user',
    kind: 'URL',
    state: 'ACTIVE',
    displayName: 'Spec',
    url: 'https://docs.example.com/spec',
    originalFilename: null,
    mimeType: null,
    byteSize: null,
    revision: 1,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

function attachmentsApi(
  initial: (card: Card) => Attachment[],
  handlers: (card: Card, base: string) => Record<string, Handler> = () => ({}),
) {
  let items: Attachment[] | undefined;
  return {
    set: (next: Attachment[]) => {
      items = next;
    },
    extra: (card: Card, path: string) => {
      const base = `${path}/attachments`;
      return {
        [`GET ${base}?page=1&limit=5`]: () => {
          items ??= initial(card);
          return okPage(items, { limit: 5 });
        },
        ...handlers(card, base),
      } as Record<string, Handler>;
    },
  };
}

const file = (name: string, type: string, size = 12) =>
  new File([new Uint8Array(size)], name, { type });

const pickFile = (view: HTMLElement, chosen: File) => {
  const input = view.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [chosen] } });
};

beforeEach(() => {
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn(),
    }),
  );
});
afterEach(() => {
  vi.mocked(HTMLAnchorElement.prototype.click).mockRestore?.();
});

describe('attachment link safety', () => {
  it('accepts only HTTPS links without credentials', () => {
    expect(safeHttpsUrl('https://example.com/a')?.hostname).toBe('example.com');
    for (const unsafe of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'file:///etc/passwd',
      'http://example.com',
      'https://user:pass@example.com',
      'not a url',
    ])
      expect(safeHttpsUrl(unsafe)).toBeNull();
  });
});

describe('Card Detail attachments', () => {
  it('lists links and files with safe external links and file details', async () => {
    const api = attachmentsApi((card) => [
      attachment(card, {}),
      attachment(card, {
        id: 'att-2',
        kind: 'FILE',
        displayName: 'Plan.pdf',
        url: null,
        originalFilename: 'Plan.pdf',
        mimeType: 'application/pdf',
        byteSize: 1_258_291,
      }),
    ]);
    const { dialog } = openCardDetail({ extra: api.extra });
    const view = await dialog();
    const link = await within(view).findByRole('link', { name: /Spec/ });
    expect(link.getAttribute('href')).toBe('https://docs.example.com/spec');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toContain('opens docs.example.com in a new tab');
    expect(within(view).getByText(/1.2 MB · PDF/)).toBeTruthy();
    // Documents download; only verified raster images preview.
    expect(
      within(view).getByRole('button', { name: 'Download Plan.pdf' }),
    ).toBeTruthy();
    expect(
      within(view).queryByRole('button', { name: 'Preview Plan.pdf' }),
    ).toBeNull();
  });

  it('adds a link with one idempotency key, reused when retrying', async () => {
    let attempts = 0;
    const api = attachmentsApi(
      () => [],
      (card, base) => ({
        [`POST ${base}`]: (request) => {
          attempts++;
          if (attempts === 1) return fail(503, 'SERVICE_UNAVAILABLE');
          const created = attachment(card, {
            url: (request.body as { url: string }).url,
            displayName: 'Roadmap',
          });
          api.set([created]);
          return ok(created, 201);
        },
      }),
    );
    const { calls, dialog } = openCardDetail({ extra: api.extra });
    const view = await dialog();
    fireEvent.click(
      await within(view).findByRole('button', { name: 'Add attachment' }),
    );
    fireEvent.click(within(view).getByRole('button', { name: 'Add link' }));
    fireEvent.change(within(view).getByLabelText('Link'), {
      target: { value: 'javascript:alert(1)' },
    });
    fireEvent.click(within(view).getByRole('button', { name: 'Add link' }));
    expect(
      within(view).getByText('Enter a link that starts with https://.'),
    ).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);

    fireEvent.change(within(view).getByLabelText('Link'), {
      target: { value: ' https://example.com/roadmap ' },
    });
    fireEvent.change(within(view).getByLabelText('Name (optional)'), {
      target: { value: 'Roadmap' },
    });
    fireEvent.click(within(view).getByRole('button', { name: 'Add link' }));
    expect(
      await within(view).findByText(
        'The server is busy. Try again in a moment.',
      ),
    ).toBeTruthy();
    fireEvent.click(within(view).getByRole('button', { name: 'Add link' }));
    expect(
      await within(view).findByRole('link', { name: /Roadmap/ }),
    ).toBeTruthy();
    const posts = writes(calls);
    expect(posts.map((call) => call.body)).toEqual([
      {
        kind: 'URL',
        url: 'https://example.com/roadmap',
        displayName: 'Roadmap',
      },
      {
        kind: 'URL',
        url: 'https://example.com/roadmap',
        displayName: 'Roadmap',
      },
    ]);
    const keys = posts.map((call) => call.headers['Idempotency-Key']);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it('uploads through intent, transfer and verification, succeeding only after completion', async () => {
    let complete: (response: MockResponse) => void = () => {};
    const api = attachmentsApi(
      () => [],
      (card, base) => ({
        [`POST ${base}/uploads`]: ok(
          {
            uploadId: 'up-1',
            state: 'PENDING',
            expiresAt: stamp,
            upload: {
              kind: 'memory',
              url: `/api${base}/uploads/up-1/file`,
              fields: {},
              expiresAt: stamp,
            },
          },
          201,
        ),
        [`POST ${base}/uploads/up-1/file`]: { status: 204 },
        [`POST ${base}/uploads/up-1/complete`]: () =>
          new Promise<MockResponse>((resolve) => {
            complete = (response) => {
              api.set([
                attachment(card, {
                  kind: 'FILE',
                  displayName: 'shot.png',
                  url: null,
                  mimeType: 'image/png',
                  byteSize: 12,
                }),
              ]);
              resolve(response);
            };
          }),
      }),
    );
    const { calls, path, dialog } = openCardDetail({ extra: api.extra });
    const view = await dialog();
    await within(view).findByText('No attachments yet.');
    pickFile(view, file('shot.png', 'image/png'));
    expect(
      await within(view).findByText(/Checking the file on the server…/),
    ).toBeTruthy();
    expect(within(view).queryByText(/Attached\./)).toBeNull();
    const base = `${path}/attachments`;
    expect(writes(calls).map((call) => call.path)).toEqual([
      `${base}/uploads`,
      `${base}/uploads/up-1/file`,
      `${base}/uploads/up-1/complete`,
    ]);
    const [intent, transfer, completion] = writes(calls);
    expect(intent.body).toEqual({
      filename: 'shot.png',
      contentType: 'image/png',
      fileSize: 12,
    });
    expect(intent.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(transfer.headers.Authorization).toMatch(/^Bearer /);
    expect(completion.body).toEqual({});
    complete(ok(attachment({ boardId: 'b', id: 'c' } as Card, {})));
    expect(await within(view).findByText(/Attached\./)).toBeTruthy();
    expect(
      await within(view).findByRole('button', { name: 'Preview shot.png' }),
    ).toBeTruthy();
  });

  it('refuses unsupported or oversized files before asking the server', async () => {
    const { calls, dialog } = openCardDetail({
      extra: attachmentsApi(() => []).extra,
    });
    const view = await dialog();
    await within(view).findByText('No attachments yet.');
    pickFile(view, file('run.exe', 'application/x-msdownload'));
    expect(
      within(view).getByText(
        'Only PNG, JPEG, WebP, PDF and plain-text (.txt) files are supported.',
      ),
    ).toBeTruthy();
    pickFile(view, file('big.pdf', 'application/pdf', 10 * 1024 * 1024 + 1));
    expect(within(view).getByText('Files can be at most 10 MB.')).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
  });

  it('says honestly when file storage is disabled and keeps links available', async () => {
    const api = attachmentsApi(
      () => [],
      (_card, base) => ({
        [`POST ${base}/uploads`]: fail(503, 'ATTACHMENT_FILES_NOT_AVAILABLE'),
      }),
    );
    const { dialog } = openCardDetail({ extra: api.extra });
    const view = await dialog();
    await within(view).findByText('No attachments yet.');
    pickFile(view, file('notes.txt', 'text/plain'));
    expect(
      await within(view).findByText(
        'File uploads are not available on this server. Link attachments still work.',
      ),
    ).toBeTruthy();
    expect(
      within(view).queryByRole('button', { name: 'Try again' }),
    ).toBeNull();
    fireEvent.click(within(view).getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(
      within(view).getByRole('button', { name: 'Add attachment' }),
    );
    expect(
      within(view).queryByRole('button', { name: 'Upload file' }),
    ).toBeNull();
    expect(within(view).getByRole('button', { name: 'Add link' })).toBeTruthy();
  });

  it('reports failed verification without success and cancels the intent', async () => {
    const api = attachmentsApi(
      () => [],
      (_card, base) => ({
        [`POST ${base}/uploads`]: ok(
          {
            uploadId: 'up-2',
            state: 'PENDING',
            expiresAt: stamp,
            upload: null,
          },
          201,
        ),
        [`POST ${base}/uploads/up-2/complete`]: fail(
          422,
          'ATTACHMENT_PDF_UNSUPPORTED',
        ),
        [`DELETE ${base}/uploads/up-2`]: { status: 204 },
      }),
    );
    const { calls, path, dialog } = openCardDetail({ extra: api.extra });
    const view = await dialog();
    await within(view).findByText('No attachments yet.');
    pickFile(view, file('scan.pdf', 'application/pdf'));
    expect(
      await within(view).findByText(/did not pass the server’s format check/),
    ).toBeTruthy();
    expect(within(view).queryByText(/Attached\./)).toBeNull();
    await waitFor(() =>
      expect(writes(calls).at(-1)).toMatchObject({
        method: 'DELETE',
        path: `${path}/attachments/uploads/up-2`,
      }),
    );
  });

  it('downloads private files through the API with the token, not a public URL', async () => {
    const api = attachmentsApi(
      (card) => [
        attachment(card, {
          kind: 'FILE',
          displayName: 'Plan.pdf',
          url: null,
          originalFilename: 'Plan.pdf',
          mimeType: 'application/pdf',
          byteSize: 10,
        }),
      ],
      (_card, base) => ({
        [`GET ${base}/att-1/file`]: { status: 200, body: 'pdf-bytes' },
      }),
    );
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(`${this.download} ${this.href}`);
    });
    const { calls, path, dialog } = openCardDetail({ extra: api.extra });
    const view = await dialog();
    fireEvent.click(
      await within(view).findByRole('button', { name: 'Download Plan.pdf' }),
    );
    await waitFor(() => expect(clicked).toEqual(['Plan.pdf blob:preview']));
    const request = calls.find(
      (call) => call.path === `${path}/attachments/att-1/file`,
    )!;
    expect(request.headers.Authorization).toMatch(/^Bearer /);
    expect(view.querySelector('a[href*="/file"]')).toBeNull();
  });

  it('edits with the expected revision and explains a concurrent change', async () => {
    const api = attachmentsApi(
      (card) => [attachment(card, { revision: 3 })],
      (_card, base) => ({
        [`PATCH ${base}/att-1`]: fail(409, 'ATTACHMENT_REVISION_CONFLICT'),
      }),
    );
    const { calls, dialog } = openCardDetail({ extra: api.extra });
    const view = await dialog();
    fireEvent.click(
      await within(view).findByRole('button', { name: 'Edit Spec' }),
    );
    fireEvent.change(within(view).getByLabelText('Name'), {
      target: { value: 'Spec v2' },
    });
    fireEvent.click(within(view).getByRole('button', { name: 'Save' }));
    expect(
      await within(view).findByText(/Someone else changed this attachment/),
    ).toBeTruthy();
    expect(writes(calls)[0].body).toEqual({
      expectedRevision: 3,
      displayName: 'Spec v2',
    });
  });

  it('removes after confirmation with the expected revision', async () => {
    const api = attachmentsApi(
      (card) => [attachment(card, { revision: 2 })],
      (_card, base) => ({
        [`DELETE ${base}/att-1?expectedRevision=2`]: () => {
          api.set([]);
          return { status: 204 };
        },
      }),
    );
    const { calls, dialog } = openCardDetail({ extra: api.extra });
    const view = await dialog();
    fireEvent.click(
      await within(view).findByRole('button', { name: 'Remove Spec' }),
    );
    expect(writes(calls)).toHaveLength(0);
    fireEvent.click(within(view).getByRole('button', { name: 'Remove' }));
    expect(await within(view).findByText('No attachments yet.')).toBeTruthy();
  });

  it('lets read-only viewers open and download but not change anything', async () => {
    const api = attachmentsApi((card) => [
      attachment(card, {}),
      attachment(card, {
        id: 'att-2',
        kind: 'FILE',
        displayName: 'Plan.pdf',
        url: null,
        mimeType: 'application/pdf',
        byteSize: 5,
      }),
    ]);
    const { dialog } = openCardDetail({
      readOnlyViewer: true,
      extra: api.extra,
    });
    const view = await dialog();
    expect(
      await within(view).findByRole('button', { name: 'Download Plan.pdf' }),
    ).toBeTruthy();
    for (const name of ['Add attachment', 'Edit Spec', 'Remove Spec'])
      expect(within(view).queryByRole('button', { name })).toBeNull();
  });
});

describe('file transfer target', () => {
  const intent = (url: string, kind: 's3' | 'memory' = 's3') => ({
    uploadId: 'up-1',
    state: 'PENDING' as const,
    expiresAt: stamp,
    upload: { kind, url, fields: { key: 'k', policy: 'p' }, expiresAt: stamp },
  });

  it('posts every field then the file to S3 without our token or cookies', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const chosen = file('a.png', 'image/png');
    await transferFile(
      intent('https://bucket.s3.amazonaws.com/'),
      chosen,
      'board',
      'card',
      'secret-token',
      new AbortController().signal,
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://bucket.s3.amazonaws.com/');
    expect(init.credentials).toBe('omit');
    expect(JSON.stringify(init.headers ?? {})).not.toContain('secret-token');
    const body = init.body as FormData;
    expect([...body.keys()]).toEqual(['key', 'policy', 'file']);
  });

  it.each(['/api', 'https://api.example.test/api'])(
    'resolves memory transfers safely with API base %s',
    async (base) => {
      const previous = env.apiBaseUrl;
      env.apiBaseUrl = base;
      try {
        const fetchMock = vi.fn(
          async () => new Response(null, { status: 204 }),
        );
        vi.stubGlobal('fetch', fetchMock);
        const path =
          '/api/boards/board/cards/card/attachments/uploads/up-1/file';
        const signal = new AbortController().signal;
        const chosen = file('a.txt', 'text/plain');
        await transferFile(
          intent(path, 'memory'),
          chosen,
          'board',
          'card',
          'token',
          signal,
        );
        expect(fetchMock).toHaveBeenCalledWith(
          new URL(path, new URL(base, window.location.origin)).href,
          expect.objectContaining({
            method: 'POST',
            signal,
            headers: { Authorization: 'Bearer token' },
          }),
        );
        for (const unsafe of [
          '//evil.example.test' + path,
          path.replace('/cards/card/', '/cards/other/'),
        ])
          await expect(
            transferFile(
              intent(unsafe, 'memory'),
              chosen,
              'board',
              'card',
              'token',
              signal,
            ),
          ).rejects.toThrow('Invalid local upload target.');
        expect(fetchMock).toHaveBeenCalledTimes(1);
      } finally {
        env.apiBaseUrl = previous;
      }
    },
  );

  it('refuses non-HTTPS storage and foreign memory targets', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const signal = new AbortController().signal;
    await expect(
      transferFile(
        intent('http://bucket.example.com/'),
        file('a.png', 'image/png'),
        'board',
        'card',
        'token',
        signal,
      ),
    ).rejects.toThrow('Invalid upload target.');
    await expect(
      transferFile(
        intent(
          'https://evil.example.com/api/boards/board/cards/card/attachments/uploads/up-1/file',
          'memory',
        ),
        file('a.png', 'image/png'),
        'board',
        'card',
        'token',
        signal,
      ),
    ).rejects.toThrow('Invalid local upload target.');
    expect(fetch).not.toHaveBeenCalled();
  });
});
