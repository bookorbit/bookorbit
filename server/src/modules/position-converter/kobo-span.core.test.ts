import { describe, expect, it } from 'vitest';

import {
  buildKoboSpanIndex,
  canonicalCfiToKoboSpan,
  cfiPointToKoboSpanPoint,
  koboSpanPointToCanonical,
  koboSpanRangeToCanonical,
  parseSpanSelector,
  spanSelectorFromId,
  utf16OffsetForCodePointCount,
} from './kobo-span.core';
import { cfiRangeToCollapsed, parseChapterDocument, xpointerRangeToCfi } from './position-converter.core';

const EPUB_CHAPTER = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>T</title></head>
<body>
  <p>First sentence here. Second sentence follows!</p>
  <p>Another <em>styled</em> paragraph.</p>
</body>
</html>`;

const KEPUB_CHAPTER = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>T</title></head>
<body><div id="book-columns"><div id="book-inner">
  <p><span class="koboSpan" id="kobo.1.1">First sentence here. </span><span class="koboSpan" id="kobo.1.2">Second sentence follows!</span></p>
  <p><span class="koboSpan" id="kobo.2.1">Another </span><em><span class="koboSpan" id="kobo.2.2">styled</span></em><span class="koboSpan" id="kobo.2.3"> paragraph.</span></p>
</div></div></body>
</html>`;

const ASTRAL_EPUB = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>T</title></head>
<body><p>ab\u{1F600}cd efgh.</p></body>
</html>`;

const ASTRAL_KEPUB = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>T</title></head>
<body><div id="book-columns"><div id="book-inner"><p><span class="koboSpan" id="kobo.1.1">ab\u{1F600}cd efgh.</span></p></div></div></body>
</html>`;

const IMG_KEPUB = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>T</title></head>
<body><div id="book-columns"><div id="book-inner">
  <p><span class="koboSpan" id="kobo.1.1">Before image.</span></p>
  <span class="koboSpan" id="kobo.2.1"><img src="pic.png" alt=""/></span>
  <p><span class="koboSpan" id="kobo.3.1">After image.</span></p>
</div></div></body>
</html>`;

const IMG_EPUB = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>T</title></head>
<body>
  <p>Before image.</p>
  <img src="pic.png" alt=""/>
  <p>After image.</p>
</body>
</html>`;

function docs(epubXhtml: string, kepubXhtml: string) {
  const epubDoc = parseChapterDocument(epubXhtml);
  const kepubDoc = parseChapterDocument(kepubXhtml);
  return { epubDoc, kepubDoc, spanIndex: buildKoboSpanIndex(kepubDoc) };
}

describe('parseSpanSelector', () => {
  it('extracts ids from escaped selectors', () => {
    expect(parseSpanSelector('span#kobo\\.1\\.2')).toBe('kobo.1.2');
    expect(parseSpanSelector('#kobo.4.2')).toBe('kobo.4.2');
    expect(parseSpanSelector('OEBPS/ch1.xhtml#span#kobo\\.3\\.1')).toBe('kobo.3.1');
    expect(parseSpanSelector('span.koboSpan')).toBeNull();
  });

  it('round-trips through spanSelectorFromId', () => {
    expect(parseSpanSelector(spanSelectorFromId('kobo.12.34'))).toBe('kobo.12.34');
  });
});

describe('buildKoboSpanIndex', () => {
  it('indexes spans with collapsed ranges matching the epub text', () => {
    const { epubDoc, kepubDoc, spanIndex } = docs(EPUB_CHAPTER, KEPUB_CHAPTER);
    expect(kepubDoc.index.collapsed).toBe(epubDoc.index.collapsed);
    expect(spanIndex.ordered.map((s) => s.id)).toEqual(['kobo.1.1', 'kobo.1.2', 'kobo.2.1', 'kobo.2.2', 'kobo.2.3']);

    const first = spanIndex.byId.get('kobo.1.1')!;
    expect(kepubDoc.index.extractCollapsed(first.collapsedStart, first.collapsedEnd)).toBe('First sentence here. ');
    const second = spanIndex.byId.get('kobo.1.2')!;
    expect(kepubDoc.index.extractCollapsed(second.collapsedStart, second.collapsedEnd)).toBe('Second sentence follows!');
  });

  it('anchors textless image spans to the nearest text span', () => {
    const { kepubDoc, spanIndex } = docs(IMG_EPUB, IMG_KEPUB);
    const imgSpan = spanIndex.byId.get('kobo.2.1')!;
    expect(imgSpan.synthetic).toBe(true);
    const after = spanIndex.byId.get('kobo.3.1')!;
    expect(imgSpan.collapsedStart).toBe(after.collapsedStart);
    expect(spanIndex.ordered.map((s) => s.id)).toEqual(['kobo.1.1', 'kobo.3.1']);
    expect(kepubDoc.index.collapsed).toBe('Before image. After image.');
  });
});

describe('koboSpanRangeToCanonical', () => {
  it('converts an exact single-span range to cfi and xpointers', () => {
    const { epubDoc, kepubDoc, spanIndex } = docs(EPUB_CHAPTER, KEPUB_CHAPTER);
    const result = koboSpanRangeToCanonical(
      epubDoc,
      kepubDoc,
      spanIndex,
      0,
      { startId: 'kobo.1.2', startChar: 0, endId: 'kobo.1.2', endChar: 6 },
      'Second',
    );
    expect(result.status).toBe('exact');
    if (result.status === 'failed') return;
    expect(epubDoc.index.extractCollapsed(result.startCp, result.endCp)).toBe('Second');

    const roundTrip = cfiRangeToCollapsed(epubDoc, result.cfi);
    expect(roundTrip).toEqual({ startCp: result.startCp, endCp: result.endCp });

    const viaXPointer = xpointerRangeToCfi(epubDoc, 0, result.xpointerPos0, result.xpointerPos1, 'Second');
    expect(viaXPointer.status).toBe('exact');
    if (viaXPointer.status !== 'failed') expect(viaXPointer.pos0).toBe(result.cfi);
  });

  it('converts a range spanning two spans', () => {
    const { epubDoc, kepubDoc, spanIndex } = docs(EPUB_CHAPTER, KEPUB_CHAPTER);
    const result = koboSpanRangeToCanonical(
      epubDoc,
      kepubDoc,
      spanIndex,
      0,
      { startId: 'kobo.1.1', startChar: 6, endId: 'kobo.1.2', endChar: 15 },
      'sentence here. Second sentence',
    );
    expect(result.status).toBe('exact');
    if (result.status === 'failed') return;
    expect(epubDoc.index.extractCollapsed(result.startCp, result.endCp)).toBe('sentence here. Second sentence');
  });

  it('resolves structurally without text', () => {
    const { epubDoc, kepubDoc, spanIndex } = docs(EPUB_CHAPTER, KEPUB_CHAPTER);
    const result = koboSpanRangeToCanonical(
      epubDoc,
      kepubDoc,
      spanIndex,
      0,
      { startId: 'kobo.2.2', startChar: 0, endId: 'kobo.2.2', endChar: 6 },
      null,
    );
    expect(result.status).toBe('exact');
    if (result.status === 'failed') return;
    expect(epubDoc.index.extractCollapsed(result.startCp, result.endCp)).toBe('styled');
  });

  it('retries char offsets as code points when UTF-16 interpretation mismatches', () => {
    const { epubDoc, kepubDoc, spanIndex } = docs(ASTRAL_EPUB, ASTRAL_KEPUB);
    // "cd" in code points: start 3, end 5 (UTF-16 would be 4 and 6).
    const result = koboSpanRangeToCanonical(
      epubDoc,
      kepubDoc,
      spanIndex,
      0,
      { startId: 'kobo.1.1', startChar: 3, endChar: 5, endId: 'kobo.1.1' },
      'cd',
    );
    expect(result.status).toBe('exact');
    if (result.status === 'failed') return;
    expect(epubDoc.index.extractCollapsed(result.startCp, result.endCp)).toBe('cd');
  });

  it('repairs via text search when the span is missing', () => {
    const { epubDoc, kepubDoc, spanIndex } = docs(EPUB_CHAPTER, KEPUB_CHAPTER);
    const result = koboSpanRangeToCanonical(
      epubDoc,
      kepubDoc,
      spanIndex,
      0,
      { startId: 'kobo.9.9', startChar: 0, endId: 'kobo.9.9', endChar: 6 },
      'styled',
    );
    expect(result.status).toBe('repaired');
    if (result.status === 'failed') return;
    expect(epubDoc.index.extractCollapsed(result.startCp, result.endCp)).toBe('styled');
  });

  it('repairs via epub text search when kepub text is misaligned', () => {
    const misalignedKepub = KEPUB_CHAPTER.replace('First sentence here.', 'First sentence HERE!');
    const { epubDoc, kepubDoc, spanIndex } = docs(EPUB_CHAPTER, misalignedKepub);
    expect(kepubDoc.index.collapsed).not.toBe(epubDoc.index.collapsed);
    const result = koboSpanRangeToCanonical(
      epubDoc,
      kepubDoc,
      spanIndex,
      0,
      { startId: 'kobo.1.2', startChar: 0, endId: 'kobo.1.2', endChar: 6 },
      'Second',
    );
    expect(result.status).toBe('repaired');
    if (result.status === 'failed') return;
    expect(epubDoc.index.extractCollapsed(result.startCp, result.endCp)).toBe('Second');
  });

  it('fails with span_not_found when structure is missing and no text is given', () => {
    const { epubDoc, kepubDoc, spanIndex } = docs(EPUB_CHAPTER, KEPUB_CHAPTER);
    const result = koboSpanRangeToCanonical(
      epubDoc,
      kepubDoc,
      spanIndex,
      0,
      { startId: 'kobo.9.9', startChar: 0, endId: 'kobo.9.9', endChar: 3 },
      null,
    );
    expect(result).toEqual({ status: 'failed', reason: 'span_not_found' });
  });

  it('fails with span_not_found when both the spans and the text are missing', () => {
    const { epubDoc, kepubDoc, spanIndex } = docs(EPUB_CHAPTER, KEPUB_CHAPTER);
    const result = koboSpanRangeToCanonical(
      epubDoc,
      kepubDoc,
      spanIndex,
      0,
      { startId: 'kobo.9.9', startChar: 0, endId: 'kobo.9.9', endChar: 3 },
      'absent words entirely',
    );
    expect(result).toEqual({ status: 'failed', reason: 'span_not_found' });
  });

  it('fails with text_not_found when spans resolve but the text is absent', () => {
    const { epubDoc, kepubDoc, spanIndex } = docs(EPUB_CHAPTER, KEPUB_CHAPTER);
    const result = koboSpanRangeToCanonical(
      epubDoc,
      kepubDoc,
      spanIndex,
      0,
      { startId: 'kobo.1.1', startChar: 0, endId: 'kobo.1.1', endChar: 21 },
      'absent words entirely',
    );
    expect(result).toEqual({ status: 'failed', reason: 'text_mismatch' });
  });
});

describe('canonicalCfiToKoboSpan', () => {
  it('round-trips a single-span range', () => {
    const { epubDoc, kepubDoc, spanIndex } = docs(EPUB_CHAPTER, KEPUB_CHAPTER);
    const forward = koboSpanRangeToCanonical(
      epubDoc,
      kepubDoc,
      spanIndex,
      0,
      { startId: 'kobo.1.2', startChar: 0, endId: 'kobo.1.2', endChar: 6 },
      'Second',
    );
    expect(forward.status).toBe('exact');
    if (forward.status === 'failed') return;

    const back = canonicalCfiToKoboSpan(epubDoc, kepubDoc, spanIndex, forward.cfi, 'Second');
    expect(back.status).toBe('exact');
    if (back.status === 'failed') return;
    expect(back).toMatchObject({ startId: 'kobo.1.2', startChar: 0, endId: 'kobo.1.2', endChar: 6 });
  });

  it('round-trips a multi-span range', () => {
    const { epubDoc, kepubDoc, spanIndex } = docs(EPUB_CHAPTER, KEPUB_CHAPTER);
    const forward = koboSpanRangeToCanonical(
      epubDoc,
      kepubDoc,
      spanIndex,
      0,
      { startId: 'kobo.1.1', startChar: 6, endId: 'kobo.1.2', endChar: 15 },
      'sentence here. Second sentence',
    );
    expect(forward.status).toBe('exact');
    if (forward.status === 'failed') return;

    const back = canonicalCfiToKoboSpan(epubDoc, kepubDoc, spanIndex, forward.cfi, 'sentence here. Second sentence');
    expect(back.status).toBe('exact');
    if (back.status === 'failed') return;
    expect(back).toMatchObject({ startId: 'kobo.1.1', startChar: 6, endId: 'kobo.1.2', endChar: 15 });
  });

  it('keeps an exclusive end at the span boundary inside the start span', () => {
    const { epubDoc, kepubDoc, spanIndex } = docs(EPUB_CHAPTER, KEPUB_CHAPTER);
    const forward = koboSpanRangeToCanonical(
      epubDoc,
      kepubDoc,
      spanIndex,
      0,
      { startId: 'kobo.1.1', startChar: 0, endId: 'kobo.1.1', endChar: 20 },
      'First sentence here.',
    );
    expect(forward.status).toBe('exact');
    if (forward.status === 'failed') return;

    const back = canonicalCfiToKoboSpan(epubDoc, kepubDoc, spanIndex, forward.cfi, 'First sentence here.');
    expect(back.status).toBe('exact');
    if (back.status === 'failed') return;
    expect(back.startId).toBe('kobo.1.1');
    expect(back.endId).toBe('kobo.1.1');
    expect(back.endChar).toBe(20);
  });

  it('repairs from text when the cfi does not resolve', () => {
    const { epubDoc, kepubDoc, spanIndex } = docs(EPUB_CHAPTER, KEPUB_CHAPTER);
    const back = canonicalCfiToKoboSpan(epubDoc, kepubDoc, spanIndex, 'epubcfi(/6/2!/4/99/1:0,/1:6)', 'styled');
    expect(back.status).toBe('repaired');
    if (back.status === 'failed') return;
    expect(back.startId).toBe('kobo.2.2');
    expect(back.startChar).toBe(0);
    expect(back.endId).toBe('kobo.2.2');
    expect(back.endChar).toBe(6);
  });

  it('fails when the highlight text is not in the kepub chapter', () => {
    const { epubDoc, kepubDoc, spanIndex } = docs(EPUB_CHAPTER, KEPUB_CHAPTER);
    const back = canonicalCfiToKoboSpan(epubDoc, kepubDoc, spanIndex, 'epubcfi(/6/2!/4/99/1:0,/1:6)', 'absent words entirely');
    expect(back).toEqual({ status: 'failed', reason: 'text_not_found' });
  });
});

describe('point conversions for reading position', () => {
  it('converts a span id to a point cfi and xpointer and back', () => {
    const { epubDoc, kepubDoc, spanIndex } = docs(EPUB_CHAPTER, KEPUB_CHAPTER);
    const point = koboSpanPointToCanonical(epubDoc, kepubDoc, spanIndex, 0, 'kobo.2.1');
    expect(point.status).toBe('exact');
    if (point.status === 'failed') return;
    expect(point.cfi).toContain('epubcfi(');
    expect(point.xpointer).toContain('/body/DocFragment[1]/');
    expect(point.chapterFraction).toBeGreaterThan(0);

    const back = cfiPointToKoboSpanPoint(epubDoc, kepubDoc, spanIndex, point.cfi);
    expect(back.status).toBe('exact');
    if (back.status === 'failed') return;
    expect(back.spanId).toBe('kobo.2.1');
  });

  it('snaps a textless image span to its neighbor for point conversion', () => {
    const { epubDoc, kepubDoc, spanIndex } = docs(IMG_EPUB, IMG_KEPUB);
    const point = koboSpanPointToCanonical(epubDoc, kepubDoc, spanIndex, 0, 'kobo.2.1');
    expect(point.status).toBe('repaired');
    if (point.status === 'failed') return;
    const after = spanIndex.byId.get('kobo.3.1')!;
    expect(point.cp).toBe(after.collapsedStart);
  });

  it('fails for unknown span ids', () => {
    const { epubDoc, kepubDoc, spanIndex } = docs(EPUB_CHAPTER, KEPUB_CHAPTER);
    expect(koboSpanPointToCanonical(epubDoc, kepubDoc, spanIndex, 0, 'kobo.99.99')).toEqual({ status: 'failed', reason: 'span_not_found' });
  });
});

describe('utf16OffsetForCodePointCount', () => {
  it('accounts for astral characters', () => {
    expect(utf16OffsetForCodePointCount('ab\u{1F600}cd', 3)).toBe(4);
    expect(utf16OffsetForCodePointCount('abc', 2)).toBe(2);
    expect(utf16OffsetForCodePointCount('abc', 10)).toBe(3);
  });
});
