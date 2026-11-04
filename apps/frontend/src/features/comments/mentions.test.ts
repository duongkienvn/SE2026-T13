import { describe, expect, it } from 'vitest';
import {
  activeMention,
  capError,
  finalizeMentions,
  insertMention,
  keepValidSpans,
  rebaseSpans,
  searchKey,
  splitContent,
  suggest,
  validRenderSpans,
} from './mentions';

const linh = { userId: 'u-linh', displayName: 'Linh' };
const dang = { userId: 'u-dang', displayName: 'Đặng Thị Linh' };
const ann = { userId: 'u-ann', displayName: 'Ann' };
const span = (userId: string, start: number, end: number) => ({
  userId,
  start,
  end,
});

describe('UTF-16 offsets (P4-04 vector)', () => {
  it('counts an emoji as two code units', () => {
    const text = '😀 @Linh';
    expect(text.slice(3, 8)).toBe('@Linh');
    expect(validRenderSpans(text, [span('u', 3, 8)])).toHaveLength(1);
  });

  it('rejects a span that splits a surrogate pair', () => {
    expect(validRenderSpans('😀@Linh', [span('u', 1, 7)])).toBeUndefined();
  });
});

describe('activeMention', () => {
  it('opens after start, whitespace and punctuation', () => {
    expect(activeMention('@Li', 3, [])).toEqual({ start: 0, query: 'Li' });
    expect(activeMention('hi @', 4, [])).toEqual({ start: 3, query: '' });
    expect(activeMention('(@an', 4, [])).toEqual({ start: 1, query: 'an' });
    expect(activeMention('Đặng @Đặ', 8, [])).toEqual({
      start: 5,
      query: 'Đặ',
    });
  });

  it('allows a space inside a multi-word name', () => {
    expect(activeMention('@Đặng Th', 8, [])).toEqual({
      start: 0,
      query: 'Đặng Th',
    });
  });

  it('never opens inside an email address, after a line break or inside a mention', () => {
    expect(activeMention('ada@example', 11, [])).toBeUndefined();
    expect(activeMention('@Li\nok', 6, [])).toBeUndefined();
    expect(activeMention('@ Li', 4, [])).toBeUndefined();
    expect(activeMention('@Linh', 5, [span('u', 0, 5)])).toBeUndefined();
  });
});

describe('suggest', () => {
  const people = [linh, dang, ann, { userId: 'u-linh-2', displayName: 'Linh' }];

  it('matches case- and accent-insensitively, prefix first, max eight', () => {
    expect(suggest(people, 'li').map((p) => p.userId)).toEqual([
      'u-linh',
      'u-linh-2',
      'u-dang',
    ]);
    expect(suggest(people, 'dang').map((p) => p.userId)).toEqual(['u-dang']);
    expect(
      suggest(
        Array.from({ length: 12 }, (_, i) => ({
          userId: `u${i}`,
          displayName: `Member ${i}`,
        })),
        'm',
      ),
    ).toHaveLength(8);
    expect(searchKey('Đặng')).toBe('dang');
  });
});

describe('insertMention', () => {
  it('replaces only the active token, adds a space and records the span', () => {
    const text = 'Hi @li and more';
    const result = insertMention(text, [], { start: 3, query: 'li' }, 6, linh);
    expect(result.text).toBe('Hi @Linh and more');
    expect(result.text.slice(result.spans[0].start, result.spans[0].end)).toBe(
      '@Linh',
    );
    expect(result.caret).toBe(8);
  });

  it('appends a space at the end and shifts later spans', () => {
    const result = insertMention(
      'x @li @Ann',
      [span('u-ann', 6, 10)],
      { start: 2, query: 'li' },
      5,
      linh,
    );
    expect(result.text).toBe('x @Linh @Ann');
    expect(result.spans).toEqual([span('u-linh', 2, 7), span('u-ann', 8, 12)]);
    const end = insertMention('@li', [], { start: 0, query: 'li' }, 3, linh);
    expect(end.text).toBe('@Linh ');
    expect(end.caret).toBe(6);
  });

  it('handles names with diacritics, spaces and emoji before the token', () => {
    const result = insertMention(
      '😀 @đặ',
      [],
      { start: 3, query: 'đặ' },
      6,
      dang,
    );
    expect(result.text).toBe('😀 @Đặng Thị Linh ');
    expect(result.spans).toEqual([
      span('u-dang', 3, 3 + '@Đặng Thị Linh'.length),
    ]);
  });
});

describe('rebaseSpans', () => {
  const text = 'a @Linh b @Ann';
  const spans = [span('u-linh', 2, 7), span('u-ann', 10, 14)];

  it('shifts spans after an insertion before them', () => {
    expect(rebaseSpans(spans, text, 'xx' + text, 2)).toEqual([
      span('u-linh', 4, 9),
      span('u-ann', 12, 16),
    ]);
  });

  it('keeps a span when typing right after it', () => {
    expect(rebaseSpans(spans, text, 'a @Linh! b @Ann', 8)).toEqual([
      span('u-linh', 2, 7),
      span('u-ann', 11, 15),
    ]);
  });

  it('drops a span edited inside, even with a repeated letter', () => {
    // "@Ann" → "@Annn" by typing inside: the link goes, the text stays.
    expect(rebaseSpans([span('u-ann', 0, 4)], '@Ann', '@Annn', 3)).toEqual([]);
    expect(rebaseSpans(spans, text, 'a @Lnh b @Ann', 4)).toEqual([
      span('u-ann', 9, 13),
    ]);
  });

  it('drops spans covered by a cut or a selection replacement', () => {
    expect(rebaseSpans(spans, text, 'a  b @Ann', 2)).toEqual([
      span('u-ann', 5, 9),
    ]);
    expect(rebaseSpans(spans, text, 'a X b @Ann', 3)).toEqual([
      span('u-ann', 6, 10),
    ]);
  });

  it('pastes before a span without moving it onto other text', () => {
    expect(rebaseSpans(spans, text, 'a @Linh b PASTE@Ann', 15)).toEqual([
      span('u-linh', 2, 7),
      span('u-ann', 15, 19),
    ]);
  });

  it('never re-attaches a link when undo restores the same text elsewhere', () => {
    const removed = rebaseSpans(spans, text, 'a  b @Ann', 2);
    expect(rebaseSpans(removed, 'a  b @Ann', text, 7)).toEqual([
      span('u-ann', 10, 14),
    ]);
  });

  it('keeps spans valid across surrogate pairs', () => {
    expect(rebaseSpans([span('u-linh', 0, 5)], '@Linh', '@Linh 😀', 8)).toEqual(
      [span('u-linh', 0, 5)],
    );
    expect(rebaseSpans([span('u-linh', 0, 5)], '@Linh', '😀@Linh', 2)).toEqual([
      span('u-linh', 2, 7),
    ]);
  });
});

describe('keepValidSpans', () => {
  it('drops spans whose member left or was renamed', () => {
    const names = new Map([['u-linh', 'Linh']]);
    expect(
      keepValidSpans(
        [span('u-linh', 0, 5), span('u-gone', 6, 10)],
        '@Linh @Ann',
        names,
      ),
    ).toEqual([span('u-linh', 0, 5)]);
    expect(
      keepValidSpans(
        [span('u-linh', 0, 5)],
        '@Linh',
        new Map([['u-linh', 'Lin']]),
      ),
    ).toEqual([]);
  });
});

describe('finalizeMentions', () => {
  it('rebases onto the trimmed content and keeps order', () => {
    expect(
      finalizeMentions('\n  @Ann hi @Linh  ', [
        span('u-linh', 11, 16),
        span('u-ann', 3, 7),
      ]),
    ).toEqual({
      content: '@Ann hi @Linh',
      mentions: [span('u-ann', 0, 4), span('u-linh', 8, 13)],
    });
  });

  it('keeps offsets exact at the 2000-character limit', () => {
    const body = 'x'.repeat(1994);
    const result = finalizeMentions(` ${body}@Linh `, [
      span('u-linh', 1995, 2000),
    ]);
    expect(result.content).toHaveLength(1999);
    expect(
      result.content.slice(result.mentions[0].start, result.mentions[0].end),
    ).toBe('@Linh');
  });
});

describe('capError', () => {
  it('enforces 20 spans and 10 people', () => {
    const many = Array.from({ length: 21 }, (_, i) =>
      span('u', i * 3, i * 3 + 2),
    );
    expect(capError(many)).toMatch(/20 mentions/);
    const people = Array.from({ length: 11 }, (_, i) =>
      span(`u${i}`, i * 3, i * 3 + 2),
    );
    expect(capError(people)).toMatch(/10 people/);
    expect(capError(many.slice(0, 20))).toBeUndefined();
  });
});

describe('render validation', () => {
  const content = 'Hi @Linh and @Ann';

  it('splits into chunks that join back to the exact text', () => {
    const spans = validRenderSpans(content, [
      span('a', 13, 17),
      span('l', 3, 8),
    ])!;
    const parts = splitContent(content, spans);
    expect(parts.map((part) => part.text).join('')).toBe(content);
    expect(parts.filter((part) => part.mention).map((p) => p.text)).toEqual([
      '@Linh',
      '@Ann',
    ]);
  });

  it.each([
    ['out of range', [span('l', 13, 40)]],
    ['overlapping', [span('l', 3, 8), span('a', 7, 10)]],
    ['not at @', [span('l', 4, 8)]],
    ['negative', [span('l', -1, 3)]],
    ['fractional', [span('l', 3.5, 8)]],
    ['not an array', { 0: span('l', 3, 8) }],
  ])('falls back to plain text when %s', (_name, value) => {
    expect(validRenderSpans(content, value)).toBeUndefined();
  });
});
