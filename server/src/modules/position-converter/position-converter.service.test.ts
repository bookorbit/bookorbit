import { parseChapterDocument } from './position-converter.core';
import { PositionConverterService } from './position-converter.service';

const STORYTELLER_CHAPTER = parseChapterDocument(`
  <html xmlns="http://www.w3.org/1999/xhtml">
    <body><p><span id="sentence-1">The first sentence.</span> <span id="sentence-2">The second sentence.</span></p></body>
  </html>
`);

const SOURCE_CHAPTER = parseChapterDocument(`
  <html xmlns="http://www.w3.org/1999/xhtml">
    <body><p>The first sentence. The second sentence.</p></body>
  </html>
`);

const DIFFERENT_CHAPTER = parseChapterDocument(`
  <html xmlns="http://www.w3.org/1999/xhtml">
    <body><p>This is a different edition.</p></body>
  </html>
`);

const DIFFERENT_ANCHORED_CHAPTER = parseChapterDocument(`
  <html xmlns="http://www.w3.org/1999/xhtml">
    <body><p><span id="sentence-1">Unrelated text with a reused identifier.</span></p></body>
  </html>
`);

function makeService(chapters: Record<number, ReturnType<typeof parseChapterDocument>>) {
  const epubDom = {
    getChapter: vi.fn((bookFileId: number) => Promise.resolve(chapters[bookFileId] ?? null)),
  };
  return { service: new PositionConverterService(epubDom as never), epubDom };
}

describe('PositionConverterService cross-edition read-aloud positions', () => {
  it('resolves a Storyteller fragment directly in the Storyteller EPUB', async () => {
    const { service } = makeService({ 1: STORYTELLER_CHAPTER });

    await expect(service.fragmentToPositions({ bookFileId: 1, chapterIndex: 0, fragment: 'sentence-2' })).resolves.toEqual(
      expect.objectContaining({ status: 'exact', chapterIndex: 0, cfi: expect.any(String), koreaderProgress: expect.any(String) }),
    );
  });

  it('maps a Storyteller fragment into an anchor-free source EPUB with identical chapter text', async () => {
    const { service } = makeService({ 1: STORYTELLER_CHAPTER, 2: SOURCE_CHAPTER });

    await expect(service.fragmentToPositions({ bookFileId: 2, sourceBookFileId: 1, chapterIndex: 0, fragment: 'sentence-2' })).resolves.toEqual(
      expect.objectContaining({ status: 'repaired', chapterIndex: 0, cfi: expect.any(String), koreaderProgress: expect.any(String) }),
    );
  });

  it('maps an anchor-free source EPUB position back to the nearest Storyteller fragment', async () => {
    const { service } = makeService({ 1: STORYTELLER_CHAPTER, 2: SOURCE_CHAPTER });
    const mapped = await service.fragmentToPositions({ bookFileId: 2, sourceBookFileId: 1, chapterIndex: 0, fragment: 'sentence-2' });
    expect(mapped.status).toBe('repaired');

    await expect(
      service.nearestFragmentForPosition({
        bookFileId: 2,
        sourceBookFileId: 1,
        cfi: mapped.cfi,
        candidates: [
          { chapterIndex: 0, fragment: 'sentence-1' },
          { chapterIndex: 0, fragment: 'sentence-2' },
        ],
      }),
    ).resolves.toEqual({ status: 'repaired', fragment: 'sentence-2', chapterIndex: 0 });
  });

  it('refuses to map a Storyteller fragment into a different chapter text', async () => {
    const { service } = makeService({ 1: STORYTELLER_CHAPTER, 3: DIFFERENT_CHAPTER });

    await expect(service.fragmentToPositions({ bookFileId: 3, sourceBookFileId: 1, chapterIndex: 0, fragment: 'sentence-1' })).resolves.toEqual({
      status: 'failed',
      reason: 'chapter_text_mismatch',
      chapterIndex: 0,
    });
  });

  it('refuses coincidentally matching fragment ids when the chapter text differs', async () => {
    const { service } = makeService({ 1: STORYTELLER_CHAPTER, 4: DIFFERENT_ANCHORED_CHAPTER });

    await expect(service.fragmentToPositions({ bookFileId: 4, sourceBookFileId: 1, chapterIndex: 0, fragment: 'sentence-1' })).resolves.toEqual({
      status: 'failed',
      reason: 'chapter_text_mismatch',
      chapterIndex: 0,
    });

    const local = await service.fragmentToPositions({ bookFileId: 4, chapterIndex: 0, fragment: 'sentence-1' });
    expect(local.status).toBe('exact');
    await expect(
      service.nearestFragmentForPosition({
        bookFileId: 4,
        sourceBookFileId: 1,
        cfi: local.cfi,
        candidates: [{ chapterIndex: 0, fragment: 'sentence-1' }],
      }),
    ).resolves.toEqual({ status: 'failed', reason: 'chapter_text_mismatch', chapterIndex: 0 });
  });
});
