import { Inject } from '@nestjs/common';
import {
  DATA_EXPORT_BYTE_LIMIT,
  BOARD_EXPORT_CSV_HEADERS,
} from '@kanban/shared';
import { validate } from 'class-validator';
import {
  DataSource,
  EntityManager,
  SelectQueryBuilder,
  ObjectLiteral,
} from 'typeorm';
import { csvCell, csvRow } from './export-csv';
import { ExportBuffer, ExportSizeBudget } from './export-buffer';
import { AccountExportQueryDto, BoardExportQueryDto } from './export-query.dto';
import { publicAvatar } from './account-export.service';
import { ExportSnapshot, exportPages } from './export-snapshot';
import { ExportsController } from './exports.controller';
import { BoardExportService } from './board-export.service';
import { AccountExportService } from './account-export.service';
import type { Response } from 'express';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: (entity: { name: string }) =>
    Inject(`${entity.name}Repository`),
}));

const identity = {
  userId: 'user',
  authVersion: 4,
  expiresAt: Date.now() + 60_000,
};
describe('export representation security', () => {
  test.each([
    '=SUM(A1:A2)',
    '+cmd',
    '-1+2',
    '@SUM(1)',
    ' \t\r\n=1',
    '\u00a0+1',
    '\u200b@cmd',
    '\ufeff-1',
    '\u0085=1',
    '\u2066=1',
    '\u0300=1',
    '\uff1d1',
    '\u2000\uff0b1',
  ])('neutralizes %j', (value) => {
    expect(csvCell(value)).toBe('"\'' + value + '"');
  });
  it('quotes delimiters, UTF-8, quotes and embedded newlines; uses CRLF without BOM', () => {
    expect(
      csvRow(['a,b', '"hello"', 'line\nnext', 'Tiếng Việt', null, true]),
    ).toBe('"a,b","""hello""","line\nnext","Tiếng Việt","","true"\r\n');
    expect(BOARD_EXPORT_CSV_HEADERS).toHaveLength(19);
    expect(csvCell('a;=text')).toBe('"a;=text"');
  });
  it('counts UTF-8 bytes exactly and rejects before buffering oversized output', () => {
    const buffer = new ExportBuffer(4);
    buffer.append('éé');
    expect(buffer.finish().length).toBe(4);
    expect(() => buffer.append('x')).toThrow('download limit');
    const exact = new ExportBuffer();
    exact.append('a'.repeat(DATA_EXPORT_BYTE_LIMIT));
    expect(exact.finish().length).toBe(DATA_EXPORT_BYTE_LIMIT);
    expect(() => exact.append('a')).toThrow('download limit');
    const budget = new ExportSizeBudget();
    expect(() => budget.json('a'.repeat(DATA_EXPORT_BYTE_LIMIT))).toThrow(
      'download limit',
    );
  });
  test.each(['csv', 'zip', null, ['json'], 'JSON'])(
    'rejects invalid account format %j',
    async (format) => {
      expect(
        await validate(Object.assign(new AccountExportQueryDto(), { format })),
      ).not.toHaveLength(0);
    },
  );
  it('defaults downloads to JSON and rejects invalid Board format', async () => {
    expect(await validate(new AccountExportQueryDto())).toHaveLength(0);
    expect(await validate(new BoardExportQueryDto())).toHaveLength(0);
    expect(
      await validate(
        Object.assign(new BoardExportQueryDto(), { format: 'csv' }),
      ),
    ).toHaveLength(0);
    expect(
      await validate(
        Object.assign(new BoardExportQueryDto(), { format: 'zip' }),
      ),
    ).not.toHaveLength(0);
  });
  test.each([
    null,
    'private/key',
    'http://example.com/a',
    'https://user:pass@example.com/a',
    'https://example.com/a?X-Amz-Signature=secret',
    'https://example.com/a#secret',
  ])('omits nonpublic or signed avatar %j', (value) =>
    expect(publicAvatar(value)).toBeNull(),
  );
  it('keeps a public HTTPS avatar', () =>
    expect(publicAvatar('https://example.com/avatar.png')).toBe(
      'https://example.com/avatar.png',
    ));
});
describe('bounded export queries and sessions', () => {
  it('uses bounded stable pages through the terminal empty page', async () => {
    const builder = {
      clone: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest
        .fn()
        .mockResolvedValueOnce(Array.from({ length: 100 }, (_, id) => ({ id })))
        .mockResolvedValueOnce([]),
    };
    const pages = [];
    for await (const page of exportPages(
      builder as unknown as SelectQueryBuilder<ObjectLiteral>,
    ))
      pages.push(page);
    expect(pages.flat()).toHaveLength(100);
    expect(builder.offset.mock.calls).toEqual([[0], [100]]);
    expect(builder.limit).toHaveBeenCalledWith(100);
  });
  it('opens a bounded read-only repeatable-read snapshot and propagates failure', async () => {
    const manager = { query: jest.fn().mockResolvedValue([]) };
    const source = {
      transaction: jest.fn(async (_isolation, fn) => fn(manager)),
    };
    const snapshots = new ExportSnapshot(source as unknown as DataSource);
    await expect(
      snapshots.read(async () => {
        throw new Error('db failure');
      }),
    ).rejects.toThrow('db failure');
    expect(source.transaction).toHaveBeenCalledWith(
      'REPEATABLE READ',
      expect.any(Function),
    );
    expect(manager.query).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
    expect(manager.query).toHaveBeenCalledWith(
      "SET LOCAL statement_timeout = '5s'",
    );
  });
  it('shares the snapshot deadline across nested collections', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const manager = { query: jest.fn().mockResolvedValue([]) };
    const source = {
      transaction: jest.fn(async (_isolation, read) => read(manager)),
    };
    const snapshots = new ExportSnapshot(source as unknown as DataSource);
    const builder = {
      clone: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    try {
      await expect(
        snapshots.read(async () => {
          clock.mockReturnValue(17_000);
          for await (const page of exportPages(
            builder as unknown as SelectQueryBuilder<ObjectLiteral>,
          ))
            void page;
        }),
      ).rejects.toThrow('Export timed out');
      expect(builder.getRawMany).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });
  it('rejects expired, invalidated and unverified identities on final check', async () => {
    const repository = {
      exists: jest.fn().mockResolvedValue(false),
      findOne: jest.fn().mockResolvedValue(null),
    };
    const manager = {
      getRepository: () => repository,
    } as unknown as EntityManager;
    const snapshots = new ExportSnapshot({} as DataSource);
    await expect(snapshots.requireSession(identity, manager)).rejects.toThrow(
      'Unauthorized',
    );
    repository.exists.mockResolvedValue(true);
    await expect(snapshots.requireSession(identity, manager)).rejects.toThrow(
      'Unauthorized',
    );
    repository.findOne.mockResolvedValue({ emailVerifiedAt: new Date() });
    await expect(
      snapshots.requireSession({ ...identity, expiresAt: 0 }, manager),
    ).rejects.toThrow('Unauthorized');
    await expect(
      snapshots.requireSession(identity, manager),
    ).resolves.toBeUndefined();
    expect(repository.exists).toHaveBeenCalledWith({
      where: { id: 'user', authVersion: 4 },
    });
  });
});
describe('publication failures', () => {
  it('never writes attachment headers or bytes when final access fails', async () => {
    const accounts = {
      create: jest.fn().mockResolvedValue({ body: Buffer.from('protected') }),
      recheck: jest.fn().mockRejectedValue(new Error('revoked')),
    };
    const snapshots = {
      read: jest.fn((fn) => fn({})),
      requireSession: jest.fn(),
    };
    const controller = new ExportsController(
      {} as BoardExportService,
      accounts as unknown as AccountExportService,
      snapshots as unknown as ExportSnapshot,
    );
    const response = {
      setHeader: jest.fn(),
      send: jest.fn(),
      status: jest.fn(),
    } as unknown as Response;
    await expect(
      controller.account(identity, new AccountExportQueryDto(), response),
    ).rejects.toThrow('revoked');
    expect(response.setHeader).not.toHaveBeenCalled();
    expect(response.send).not.toHaveBeenCalled();
  });
});
