import { describe, expect, it } from 'vitest';

import { chapterIndexFromSpineStep, parseCfi } from './cfi.utils';
import { cfiRangeToXPointer, parseChapterDocument, xpointerRangeToCfi } from './position-converter.core';
import { parseXPointer } from './xpointer.utils';

const SIMPLE_CHAPTER = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>T</title></head>
<body>
  <p>The quick brown fox jumps over the lazy dog.</p>
  <p>Second <em>paragraph</em> with <strong>nested</strong> text.</p>
</body>
</html>`;

const INDENTED_CHAPTER = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>T</title></head>
<body>
  <p>
    Hello   world
  </p>
</body>
</html>`;

const ASTRAL_CHAPTER = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>T</title></head>
<body><p>ab\u{1F600}cd efgh</p></body>
</html>`;

const MULTI_TEXT_CHAPTER = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>T</title></head>
<body><p>one <em>two</em> three</p></body>
</html>`;

describe('parseXPointer', () => {
  it('parses a plain text pointer', () => {
    const parsed = parseXPointer('/body/DocFragment[8]/body/p[20]/text().249');
    expect(parsed).toEqual({
      docFragmentIndex: 8,
      steps: [
        { name: 'body', index: 1 },
        { name: 'p', index: 20 },
      ],
      textIndex: 1,
      offset: 249,
    });
  });

  it('parses an indexed text node pointer', () => {
    const parsed = parseXPointer('/body/DocFragment[56]/body/section/p[2]/text()[1].72');
    expect(parsed).toMatchObject({ docFragmentIndex: 56, textIndex: 1, offset: 72 });
    expect(parsed!.steps).toEqual([
      { name: 'body', index: 1 },
      { name: 'section', index: 1 },
      { name: 'p', index: 2 },
    ]);
  });

  it('parses an element pointer without text or offset', () => {
    const parsed = parseXPointer('/body/DocFragment[3]/body/h1');
    expect(parsed).toMatchObject({ docFragmentIndex: 3, textIndex: null, offset: null });
  });

  it('defaults DocFragment index to 1 when unindexed', () => {
    expect(parseXPointer('/body/DocFragment/body/p/text().5')).toMatchObject({ docFragmentIndex: 1 });
  });

  it('rejects non-crengine pointers', () => {
    expect(parseXPointer('#point(/1/2)')).toBeNull();
    expect(parseXPointer('/html/body/p[1]')).toBeNull();
    expect(parseXPointer('')).toBeNull();
  });
});

describe('parseCfi', () => {
  it('parses a plain CFI with indirection and id assertion', () => {
    const parsed = parseCfi('epubcfi(/6/12[chap]!/4/2[para]/1:5)');
    expect(parsed!.spineStep).toBe(12);
    expect(parsed!.start).toEqual([{ index: 4 }, { index: 2, id: 'para' }, { index: 1, offset: 5 }]);
    expect(parsed!.end).toEqual(parsed!.start);
  });

  it('parses a range CFI, merging the parent into both endpoints', () => {
    const parsed = parseCfi('epubcfi(/6/2!/4/2,/1:4,/1:9)');
    expect(parsed!.spineStep).toBe(2);
    expect(parsed!.start).toEqual([{ index: 4 }, { index: 2 }, { index: 1, offset: 4 }]);
    expect(parsed!.end).toEqual([{ index: 4 }, { index: 2 }, { index: 1, offset: 9 }]);
  });

  it('maps spine steps to chapter indexes', () => {
    expect(chapterIndexFromSpineStep(2)).toBe(0);
    expect(chapterIndexFromSpineStep(12)).toBe(5);
    expect(chapterIndexFromSpineStep(null)).toBeNull();
    expect(chapterIndexFromSpineStep(3)).toBeNull();
  });
});

describe('xpointerRangeToCfi', () => {
  it('converts a simple in-paragraph range exactly', () => {
    const doc = parseChapterDocument(SIMPLE_CHAPTER);
    const result = xpointerRangeToCfi(doc, 0, '/body/DocFragment[1]/body/p[1]/text().4', '/body/DocFragment[1]/body/p[1]/text().9', 'quick');
    expect(result).toEqual({ status: 'exact', pos0: 'epubcfi(/6/2!/4/2,/1:4,/1:9)', pos1: null });
  });

  it('maps collapsed crengine offsets back to raw offsets in indented source', () => {
    const doc = parseChapterDocument(INDENTED_CHAPTER);
    const result = xpointerRangeToCfi(doc, 0, '/body/DocFragment[1]/body/p/text().6', '/body/DocFragment[1]/body/p/text().11', 'world');
    expect(result.status).toBe('exact');
    expect((result as { pos0: string }).pos0).toBe('epubcfi(/6/2!/4/2,/1:13,/1:18)');
  });

  it('handles astral characters with code-point offsets', () => {
    const doc = parseChapterDocument(ASTRAL_CHAPTER);
    const result = xpointerRangeToCfi(doc, 0, '/body/DocFragment[1]/body/p/text().3', '/body/DocFragment[1]/body/p/text().5', 'cd');
    expect(result.status).toBe('exact');
    expect((result as { pos0: string }).pos0).toBe('epubcfi(/6/2!/4/2,/1:4,/1:6)');
  });

  it('resolves text()[2] among multiple direct text nodes', () => {
    const doc = parseChapterDocument(MULTI_TEXT_CHAPTER);
    const result = xpointerRangeToCfi(doc, 0, '/body/DocFragment[1]/body/p/text()[2].1', '/body/DocFragment[1]/body/p/text()[2].6', 'three');
    expect(result.status).toBe('exact');
    expect((result as { pos0: string }).pos0).toBe('epubcfi(/6/2!/4/2,/3:1,/3:6)');
  });

  it('resolves ranges inside nested inline elements', () => {
    const doc = parseChapterDocument(MULTI_TEXT_CHAPTER);
    const result = xpointerRangeToCfi(doc, 0, '/body/DocFragment[1]/body/p/em/text().0', '/body/DocFragment[1]/body/p/em/text().3', 'two');
    expect(result.status).toBe('exact');
    expect((result as { pos0: string }).pos0).toBe('epubcfi(/6/2!/4/2/2,/1:0,/1:3)');
  });

  it('repairs wrong offsets by anchoring on the highlight text', () => {
    const doc = parseChapterDocument(INDENTED_CHAPTER);
    const result = xpointerRangeToCfi(doc, 0, '/body/DocFragment[1]/body/p/text().40', '/body/DocFragment[1]/body/p/text().45', 'world');
    expect(result.status).toBe('repaired');
    expect((result as { pos0: string }).pos0).toBe('epubcfi(/6/2!/4/2,/1:13,/1:18)');
  });

  it('repairs a stale element path via text search', () => {
    const doc = parseChapterDocument(SIMPLE_CHAPTER);
    const result = xpointerRangeToCfi(doc, 0, '/body/DocFragment[1]/body/p[7]/text().4', '/body/DocFragment[1]/body/p[7]/text().9', 'nested');
    expect(result.status).toBe('repaired');
    expect((result as { pos0: string }).pos0).toBe('epubcfi(/6/2!/4/4/4,/1:0,/1:6)');
  });

  it('converts cross-element ranges structurally when no text is stored', () => {
    const doc = parseChapterDocument(SIMPLE_CHAPTER);
    const result = xpointerRangeToCfi(doc, 0, '/body/DocFragment[1]/body/p[1]/text().40', '/body/DocFragment[1]/body/p[2]/text()[1].6', null);
    expect(result.status).toBe('exact');
    expect((result as { pos0: string }).pos0).toBe('epubcfi(/6/2!/4,/2/1:40,/4/1:6)');
  });

  it('fails when the text cannot be found and structure does not resolve', () => {
    const doc = parseChapterDocument(SIMPLE_CHAPTER);
    const result = xpointerRangeToCfi(
      doc,
      0,
      '/body/DocFragment[1]/body/div[9]/text().0',
      '/body/DocFragment[1]/body/div[9]/text().5',
      'absent words entirely',
    );
    expect(result).toEqual({ status: 'failed', reason: 'text_not_found' });
  });

  it('fails on cross-fragment ranges', () => {
    const doc = parseChapterDocument(SIMPLE_CHAPTER);
    const result = xpointerRangeToCfi(doc, 0, '/body/DocFragment[1]/body/p[1]/text().0', '/body/DocFragment[2]/body/p[1]/text().5', 'x');
    expect(result).toEqual({ status: 'failed', reason: 'cross_fragment_range' });
  });

  it('fails when the fragment does not match the chapter', () => {
    const doc = parseChapterDocument(SIMPLE_CHAPTER);
    const result = xpointerRangeToCfi(doc, 0, '/body/DocFragment[4]/body/p[1]/text().0', null, 'x');
    expect(result).toEqual({ status: 'failed', reason: 'fragment_mismatch' });
  });
});

describe('cfiRangeToXPointer', () => {
  it('converts a simple range with collapsed offsets', () => {
    const doc = parseChapterDocument(SIMPLE_CHAPTER);
    const result = cfiRangeToXPointer(doc, 0, 'epubcfi(/6/2!/4/2,/1:4,/1:9)', 'quick');
    expect(result).toEqual({
      status: 'exact',
      pos0: '/body/DocFragment[1]/body/p[1]/text().4',
      pos1: '/body/DocFragment[1]/body/p[1]/text().9',
    });
  });

  it('emits crengine collapsed offsets for indented raw source', () => {
    const doc = parseChapterDocument(INDENTED_CHAPTER);
    const result = cfiRangeToXPointer(doc, 0, 'epubcfi(/6/2!/4/2,/1:13,/1:18)', 'world');
    expect(result).toEqual({
      status: 'exact',
      pos0: '/body/DocFragment[1]/body/p/text().6',
      pos1: '/body/DocFragment[1]/body/p/text().11',
    });
  });

  it('round-trips astral offsets', () => {
    const doc = parseChapterDocument(ASTRAL_CHAPTER);
    const result = cfiRangeToXPointer(doc, 0, 'epubcfi(/6/2!/4/2,/1:4,/1:6)', 'cd');
    expect(result).toEqual({
      status: 'exact',
      pos0: '/body/DocFragment[1]/body/p/text().3',
      pos1: '/body/DocFragment[1]/body/p/text().5',
    });
  });

  it('emits text()[k] for later text runs and plain text() inside single-run elements', () => {
    const doc = parseChapterDocument(MULTI_TEXT_CHAPTER);
    const result = cfiRangeToXPointer(doc, 0, 'epubcfi(/6/2!/4/2,/3:1,/3:6)', 'three');
    expect(result).toEqual({
      status: 'exact',
      pos0: '/body/DocFragment[1]/body/p/text()[2].1',
      pos1: '/body/DocFragment[1]/body/p/text()[2].6',
    });

    const nested = cfiRangeToXPointer(doc, 0, 'epubcfi(/6/2!/4/2/2,/1:0,/1:3)', 'two');
    expect(nested).toEqual({
      status: 'exact',
      pos0: '/body/DocFragment[1]/body/p/em/text().0',
      pos1: '/body/DocFragment[1]/body/p/em/text().3',
    });
  });

  it('repairs a CFI whose offsets do not match the stored text', () => {
    const doc = parseChapterDocument(SIMPLE_CHAPTER);
    const result = cfiRangeToXPointer(doc, 0, 'epubcfi(/6/2!/4/2,/1:0,/1:3)', 'lazy');
    expect(result.status).toBe('repaired');
    expect(result).toMatchObject({
      pos0: '/body/DocFragment[1]/body/p[1]/text().35',
      pos1: '/body/DocFragment[1]/body/p[1]/text().39',
    });
  });

  it('converts cross-paragraph ranges', () => {
    const doc = parseChapterDocument(SIMPLE_CHAPTER);
    const result = cfiRangeToXPointer(doc, 0, 'epubcfi(/6/2!/4,/2/1:40,/4/1:6)', null);
    expect(result).toEqual({
      status: 'exact',
      pos0: '/body/DocFragment[1]/body/p[1]/text().40',
      pos1: '/body/DocFragment[1]/body/p[2]/text()[1].6',
    });
  });

  it('fails for unparsable or empty inputs', () => {
    const doc = parseChapterDocument(SIMPLE_CHAPTER);
    expect(cfiRangeToXPointer(doc, 0, 'not-a-cfi', 'x').status).toBe('failed');
    expect(cfiRangeToXPointer(doc, 0, 'epubcfi(/6/2!/4/2,/1:4,/1:4)', null).status).toBe('failed');
  });
});

describe('round trips', () => {
  const cases: Array<{ chapter: string; pos0: string; pos1: string; text: string }> = [
    {
      chapter: SIMPLE_CHAPTER,
      pos0: '/body/DocFragment[1]/body/p[1]/text().10',
      pos1: '/body/DocFragment[1]/body/p[1]/text().19',
      text: 'brown fox',
    },
    {
      chapter: INDENTED_CHAPTER,
      pos0: '/body/DocFragment[1]/body/p/text().0',
      pos1: '/body/DocFragment[1]/body/p/text().5',
      text: 'Hello',
    },
    {
      chapter: MULTI_TEXT_CHAPTER,
      pos0: '/body/DocFragment[1]/body/p/text()[1].0',
      pos1: '/body/DocFragment[1]/body/p/text()[2].6',
      text: 'one two three',
    },
  ];

  it('xpointer -> cfi -> xpointer preserves positions', () => {
    for (const testCase of cases) {
      const doc = parseChapterDocument(testCase.chapter);
      const toCfi = xpointerRangeToCfi(doc, 0, testCase.pos0, testCase.pos1, testCase.text);
      expect(toCfi.status).toBe('exact');
      const back = cfiRangeToXPointer(doc, 0, (toCfi as { pos0: string }).pos0, testCase.text);
      expect(back.status).toBe('exact');
      expect(back).toMatchObject({ pos0: testCase.pos0, pos1: testCase.pos1 });
    }
  });
});
