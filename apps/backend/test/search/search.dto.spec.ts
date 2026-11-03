import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  SearchQueryDto,
  searchWindow,
} from '../../src/api/search/dto/search-query.dto';
import { SearchResponseDto } from '../../src/api/search/dto/search-response.dto';
import { toResponseDto } from '../../src/common/dto/to-response-dto';
import {
  plainSearchSnippet,
  SEARCH_SNIPPET_LENGTH,
} from '../../src/api/search/search-snippet';
import { searchParameters } from '../../src/api/search/search-query';

const check = (input: object) =>
  validate(plainToInstance(SearchQueryDto, input), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
describe('global search query and public DTOs', () => {
  it('trims, preserves Unicode and uses type-specific defaults', async () => {
    const all = plainToInstance(SearchQueryDto, { q: '  Đường 😀  ' });
    expect(all.q).toBe('Đường 😀');
    expect(searchWindow(all)).toEqual({ limit: 5, offset: 0 });
    for (const type of ['workspaces', 'boards', 'cards']) {
      const value = plainToInstance(SearchQueryDto, { type, page: '3' });
      expect(await validate(value)).toEqual([]);
      expect(searchWindow(value)).toEqual({ limit: 20, offset: 40 });
    }
    expect(await check({})).toEqual([]);
    expect(await check({ q: '  \t\n' })).toEqual([]);
    expect(await check({ q: '😀'.repeat(120) })).toEqual([]);
    expect(
      await check({ type: 'cards', limit: '50', page: '90071992547409' }),
    ).toEqual([]);
  });

  it.each([
    { q: '😀'.repeat(121) },
    { q: 'x'.repeat(121) },
    { q: ['x'] },
    { q: null },
    { q: 'nul\0byte' },
    { q: '\ud800' },
    { q: '\udc00' },
    { type: 'workspace' },
    { type: '' },
    { type: null },
    { type: ['all'] },
    { page: '1' },
    { type: 'all', page: '1' },
    { type: 'all', limit: '11' },
    { type: 'cards', limit: '51' },
    { type: 'cards', page: '0' },
    { type: 'boards', page: '-1' },
    { type: 'workspaces', page: '1.5' },
    { type: 'cards', page: '1e2' },
    { type: 'cards', page: '01' },
    { type: 'cards', page: '9007199254740992' },
    { type: 'cards', page: '9007199254740991', limit: '50' },
    { type: 'cards', page: null },
    { type: 'cards', limit: null },
    { limit: '' },
    { limit: '0' },
    { limit: ['2'] },
    { userId: 'other' },
    { sort: 'name' },
    { offset: '1' },
    { pageSize: '50' },
    { pageNumber: '3' },
  ])('rejects invalid or unknown input %j', async (input) => {
    expect((await check(input)).length).toBeGreaterThan(0);
  });

  it('escapes SQL LIKE metacharacters without changing the literal exact-match term', () => {
    expect(searchParameters('a%_\\b')).toEqual({
      term: 'a%_\\b',
      contains: '%a\\%\\_\\\\b%',
      prefix: 'a\\%\\_\\\\b%',
    });
    expect(searchParameters("'; DROP TABLE users; --").term).toContain('DROP');
  });

  it('bounds text by Unicode code points and removes markup, controls and bidi overrides', () => {
    const text = plainSearchSnippet(
      '<script>alert(1)</script><b>Hello</b> [world](https://evil.test) **text**\n\u202Eagain\u0000',
    );
    expect(text).toBe('Hello world text again');
    expect(plainSearchSnippet('😀'.repeat(200))).toBe(
      '😀'.repeat(SEARCH_SNIPPET_LENGTH),
    );
    expect(plainSearchSnippet('')).toBe('');
    expect(plainSearchSnippet('a<>b<img src=x onerror=alert(1)>c')).not.toMatch(
      /[<>]/,
    );
  });

  it('drops confidential fields at every nested response boundary', () => {
    const hit = {
      id: 'id',
      title: 'Visible',
      type: 'card',
      subtitle: 'Safe',
      description: 'FULL PRIVATE',
      fragment: 'internal',
      passwordHash: 'private',
      rank: 0,
    };
    const value = toResponseDto(SearchResponseDto, {
      query: 'q',
      type: 'all',
      debug: 'SQL',
      groups: {
        workspaces: {
          items: [{ ...hit, type: 'workspace', email: 'private' }],
          total: 1,
          hasMore: false,
          secretCount: 99,
        },
        boards: {
          items: [{ ...hit, type: 'board', members: ['private'] }],
          total: 1,
          hasMore: false,
        },
        cards: { items: [hit], total: 1, hasMore: false },
      },
    });
    const json = JSON.stringify(value);
    for (const secret of [
      'FULL PRIVATE',
      'passwordHash',
      'fragment',
      'rank',
      'SQL',
      'secretCount',
      'members',
      'email',
    ])
      expect(json).not.toContain(secret);
    expect(value.groups.cards.items[0].subtitle).toBe('Safe');
  });
});
