import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, ok } from '../../../test/mock-api';
import { exportAccountData, exportBoardData } from './export-api';
import {
  exportFilename,
  OBJECT_URL_LIFETIME_MS,
  saveBlob,
  type ExportTarget,
} from './export-file';

const BOARD = '6f1c2b8e-3d4a-4b5c-9d8e-7f6a5b4c3d2e';
const NOW = new Date('2026-11-07T23:30:00.000+07:00'); // 16:30 UTC, same day
const LATE = new Date('2026-11-07T01:30:00.000+07:00'); // 2026-11-06 in UTC
const account: ExportTarget = { kind: 'account' };
const boardJson: ExportTarget = {
  kind: 'board',
  boardId: BOARD,
  format: 'json',
};
const boardCsv: ExportTarget = { kind: 'board', boardId: BOARD, format: 'csv' };

describe('exportFilename', () => {
  it('falls back to the documented UTC-dated names when the header is hidden', () => {
    expect(exportFilename(account, null, NOW)).toBe(
      'kanvexa-account-2026-11-07.json',
    );
    expect(exportFilename(boardCsv, null, LATE)).toBe(
      `kanvexa-board-${BOARD}-2026-11-06.csv`,
    );
  });

  it('uses a header name only when it has the exact server shape for the target', () => {
    expect(
      exportFilename(
        boardJson,
        `attachment; filename="kanvexa-board-${BOARD}-2026-11-05.json"`,
        NOW,
      ),
    ).toBe(`kanvexa-board-${BOARD}-2026-11-05.json`);
    expect(
      exportFilename(
        account,
        'attachment; filename="kanvexa-account-2026-11-05.json"',
        NOW,
      ),
    ).toBe('kanvexa-account-2026-11-05.json');
  });

  it.each([
    'attachment; filename="My secret board.json"',
    'attachment; filename="../../evil.json"',
    `attachment; filename="kanvexa-board-${BOARD}-2026-11-05.csv"`, // wrong format
    'attachment; filename="kanvexa-board-00000000-0000-4000-8000-000000000000-2026-11-05.json"',
    `attachment; filename="kanvexa-board-${BOARD}-2026-11-05.json.exe"`,
    "attachment; filename*=UTF-8''ada%40example.com.json",
    `inline; filename="x"; filename="kanvexa-board-${BOARD}-2026-11-05.json${'a'.repeat(300)}"`,
  ])('ignores an untrusted header: %s', (header) => {
    expect(exportFilename(boardJson, header, NOW)).toBe(
      `kanvexa-board-${BOARD}-2026-11-07.json`,
    );
  });

  it('refuses to build a name from a Board ID that is not a UUID', () => {
    expect(
      exportFilename(
        { kind: 'board', boardId: '../x', format: 'json' },
        null,
        NOW,
      ),
    ).toBeNull();
  });
});

describe('saveBlob', () => {
  const original = {
    create: URL.createObjectURL,
    revoke: URL.revokeObjectURL,
  };
  afterEach(() => {
    vi.useRealTimers();
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  });

  function stubObjectUrls() {
    const create = vi.fn(() => 'blob:kanvexa/1');
    const revoke = vi.fn();
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    return { create, revoke };
  }

  it('clicks a temporary download link and revokes the URL shortly after', () => {
    vi.useFakeTimers();
    const { create, revoke } = stubObjectUrls();
    const clicks: HTMLAnchorElement[] = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicks.push(this);
      });
    const blob = new Blob(['{}'], { type: 'application/json' });

    saveBlob(blob, 'kanvexa-account-2026-11-07.json');

    expect(create).toHaveBeenCalledWith(blob);
    expect(clicks).toHaveLength(1);
    expect(clicks[0].download).toBe('kanvexa-account-2026-11-07.json');
    expect(clicks[0].getAttribute('href')).toBe('blob:kanvexa/1');
    expect(clicks[0].isConnected).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(OBJECT_URL_LIFETIME_MS);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:kanvexa/1');
    click.mockRestore();
  });

  it('the returned cleanup revokes at once and only once', () => {
    vi.useFakeTimers();
    const { revoke } = stubObjectUrls();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    const dispose = saveBlob(new Blob(['a']), 'a.json');
    dispose();
    dispose();
    vi.advanceTimersByTime(OBJECT_URL_LIFETIME_MS * 2);

    expect(revoke).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });
});

describe('export API', () => {
  it('requests the current account export only', async () => {
    const calls = mockApi({ 'GET /users/me/export': ok({}) });
    await exportAccountData('token');
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /users/me/export',
    ]);
    expect(calls[0].headers).toMatchObject({ Authorization: 'Bearer token' });
  });

  it('requests a Board export in the chosen format', async () => {
    const calls = mockApi({
      [`GET /boards/${BOARD}/export?format=csv`]: { status: 200, raw: 'a' },
    });
    await exportBoardData('token', BOARD, 'csv');
    expect(calls[0].path).toBe(`/boards/${BOARD}/export?format=csv`);
    expect(calls[0].headers.Accept).toContain('text/csv');
  });
});
