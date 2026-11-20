import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gunzipSync } from 'zlib';

import { BOOK_TEXT_LIMITS } from './book-text-limits';
import { readBookText } from './book-text-reader';
import { BookTextError } from './book-text.types';
import { cssEscape, extractBookText, FOLIATE_DIR } from './foliate-book-text';
import { countWords, LONG_SECTION_WORDS, sectionParts } from './section-parts';
import { flattenSectionText, rawSectionText, sectionHash } from './section-text';

const FIXTURES = join(__dirname, '..', 'test-fixtures');

interface ExpectedSection {
  index: number;
  linear: boolean;
  length: number;
  blocks: number[];
  hash: string | null;
  error: string | null;
  text?: string;
}

function expected(format: string): { kind: string; sections: ExpectedSection[] } {
  return JSON.parse(gunzipSync(readFileSync(join(FIXTURES, 'expected', `a-study-in-scarlet.${format}.json.gz`))).toString('utf8'));
}

describe('book text', () => {
  describe.each([
    ['epub', 19],
    ['azw3', 23],
    ['mobi', 24],
  ])('the shared %s fixture', (format, sectionCount) => {
    it('reads every section exactly as the app reader does', async () => {
      const want = expected(format);
      const book = await extractBookText(join(FIXTURES, `a-study-in-scarlet.${format}`));

      expect(book.kind).toBe(want.kind);
      expect(book.sections).toHaveLength(sectionCount);
      expect(book.sections).toHaveLength(want.sections.length);
      for (const [index, section] of book.sections.entries()) {
        const wanted = want.sections[index];
        expect({ index: section.index, linear: section.linear, error: section.error }).toEqual({
          index: wanted.index,
          linear: wanted.linear,
          error: wanted.error,
        });
        expect(section.text.length).toBe(wanted.length);
        expect(section.blocks).toEqual(wanted.blocks);
        expect(section.text).toBe(wanted.text ?? '');
        if (wanted.hash) expect(section.hash).toBe(wanted.hash);
      }
      expect(book.languages).toEqual(['en']);
    });
  });

  it('names sections from the contents', async () => {
    const book = await extractBookText(join(FIXTURES, 'a-study-in-scarlet.epub'));
    const titled = book.sections.filter((section) => section.titles.length > 0);
    expect(titled.length).toBeGreaterThan(10);
    expect(titled.some((section) => section.titles.some((title) => /MR\. SHERLOCK HOLMES/i.test(title)))).toBe(true);
  });

  it('reads a book in a worker thread', async () => {
    const book = await readBookText(join(FIXTURES, 'a-study-in-scarlet.epub'));
    expect(book.sections.map((section) => section.hash)).toEqual(expected('epub').sections.map((section) => section.hash ?? sectionHash('')));
  }, 60_000);

  describe('limits', () => {
    const limits = (overrides: Partial<typeof BOOK_TEXT_LIMITS>) => ({ ...BOOK_TEXT_LIMITS, ...overrides });
    const epub = join(FIXTURES, 'a-study-in-scarlet.epub');

    it('measures a zip book by what its spine unpacks to, never by the file size', async () => {
      const book = await extractBookText(epub, FOLIATE_DIR, limits({ maxFileBytes: 1000 }));
      expect(book.sections).toHaveLength(19);
    });

    it.each([
      ['spine documents together', { maxTextBytes: 1000 }],
      ['one spine document', { maxDocumentBytes: 1000 }],
      ['zip entries', { maxEntries: 2 }],
    ])('refuses a zip book past the limit on %s', async (_, overrides) => {
      await expect(extractBookText(epub, FOLIATE_DIR, limits(overrides))).rejects.toMatchObject({ reason: 'too-large' });
    });

    it('refuses a MOBI past the file size limit', async () => {
      await expect(extractBookText(join(FIXTURES, 'a-study-in-scarlet.mobi'), FOLIATE_DIR, limits({ maxFileBytes: 1000 }))).rejects.toMatchObject({
        reason: 'too-large',
      });
    });

    it('carries a refusal out of the worker', async () => {
      await expect(readBookText(epub, { limits: { maxTextBytes: 1000 } })).rejects.toMatchObject({ reason: 'too-large' });
    }, 60_000);
  });

  it('reports a file foliate cannot open as unreadable', async () => {
    const path = join(tmpdir(), `story-guide-not-a-book-${process.pid}.epub`);
    writeFileSync(path, 'plain text, not a book');
    const error = await readBookText(path).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BookTextError);
    expect((error as BookTextError).reason).toBe('unreadable');
  }, 60_000);

  it('reports a missing file as unreadable', async () => {
    await expect(readBookText(join(tmpdir(), 'story-guide-missing.epub'))).rejects.toMatchObject({ reason: 'unreadable' });
  });

  it('gives up on a worker that does not answer in time', async () => {
    const terminate = vi.fn().mockResolvedValue(0);
    const createWorker = () => ({ once: vi.fn().mockReturnThis(), terminate });
    await expect(readBookText(join(FIXTURES, 'a-study-in-scarlet.epub'), { timeoutMs: 5, createWorker })).rejects.toMatchObject({
      reason: 'unreadable',
    });
    expect(terminate).toHaveBeenCalled();
  });
});

describe('section text rules', () => {
  it('flattens whitespace and drops invisible characters before hashing', () => {
    expect(flattenSectionText('  A\u00AD b\n\n\tc\u200B ')).toBe('A b c');
    expect(sectionHash('A b')).toBe(sectionHash(' A \n b\uFEFF'));
  });

  it('escapes selectors the way CSSOM does', () => {
    expect(cssEscape('1a')).toBe('\\31 a');
    expect(cssEscape('-')).toBe('\\-');
    expect(cssEscape('a b')).toBe('a\\ b');
    expect(cssEscape('é_-z')).toBe('é_-z');
  });

  it('starts a block where the nearest block ancestor changes and skips scripts and styles', async () => {
    const { JSDOM } = await import('jsdom');
    const doc = new JSDOM('<body><h1>Title</h1><p>One <em>two</em></p><script>x</script><span>loose</span><div>three</div></body>').window.document;
    expect(rawSectionText(doc)).toEqual({ text: 'TitleOne twoloosethree', blocks: [0, 5, 12, 17] });
  });
});

describe('long sections', () => {
  const paragraph = (words: number) => Array.from({ length: words }, (_, i) => `w${i}`).join(' ') + '. ';

  it('keeps a section up to the limit whole', () => {
    const text = paragraph(LONG_SECTION_WORDS);
    expect(sectionParts(text, [0])).toEqual([{ part: 1, start: 0, end: text.length }]);
  });

  it('cuts a long section at paragraph starts into parts of about 5,000 words', () => {
    const paragraphs = Array.from({ length: 50 }, () => paragraph(400));
    const blocks = paragraphs.reduce<number[]>((starts, _, i) => [...starts, i === 0 ? 0 : starts[i - 1] + paragraphs[i - 1].length], []);
    const text = paragraphs.join('');
    const parts = sectionParts(text, blocks);
    expect(parts).toHaveLength(4);
    for (const part of parts) {
      expect(blocks).toContain(part.start);
      expect(countWords(text.slice(part.start, part.end))).toBeGreaterThan(4000);
      expect(countWords(text.slice(part.start, part.end))).toBeLessThan(6000);
    }
    expect(parts[parts.length - 1].end).toBe(text.length);
  });

  it('cuts at a word when a stretch has no paragraph start', () => {
    const text = paragraph(12000);
    const parts = sectionParts(text, [0]);
    expect(parts).toHaveLength(2);
    expect(text[parts[1].start - 1]).toBe(' ');
  });
});

describe('vendored foliate-js', () => {
  it('matches its checksums, so an update is deliberate', () => {
    const checksums = JSON.parse(readFileSync(join(FOLIATE_DIR, 'checksums.json'), 'utf8')) as Record<string, string>;
    for (const [file, sha] of Object.entries(checksums)) {
      expect(
        createHash('sha256')
          .update(readFileSync(join(FOLIATE_DIR, file)))
          .digest('hex'),
        file,
      ).toBe(sha);
    }
    expect(Object.keys(checksums).sort()).toEqual(['LICENSE', 'epub.js', 'epubcfi.js', 'mobi.js', 'vendor/fflate.js', 'vendor/zip.js']);
  });
});
