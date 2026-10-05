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

describe('PositionConverterService reading progress points', () => {
  const chapter = (body: string) => parseChapterDocument(`<html><head><title>Position</title></head><body>${body}</body></html>`);

  it.each([
    {
      body: '<p>First paragraph.</p><p>Second paragraph.</p>',
      cfi: 'epubcfi(/6/2!/4/4/1:7)',
      pos: '/body/DocFragment[1]/body/p[2]/text().7',
      index: 0,
    },
    {
      body: '<p>First paragraph.</p><p>Second paragraph.</p>',
      cfi: 'epubcfi(/6/8!/4/4/1:7)',
      pos: '/body/DocFragment[4]/body/p[2]/text().7',
      index: 3,
    },
    { body: '<p>First paragraph.</p>', cfi: 'epubcfi(/6/2!/4/2/1:0)', pos: '/body/DocFragment[1]/body/p/text().0', index: 0 },
    { body: '<p>one <em>two</em> three</p>', cfi: 'epubcfi(/6/2!/4/2/2/1:1)', pos: '/body/DocFragment[1]/body/p/em/text().1', index: 0 },
    { body: '<p>one <em>two</em> three</p>', cfi: 'epubcfi(/6/2!/4/2/3:2)', pos: '/body/DocFragment[1]/body/p/text()[2].2', index: 0 },
    { body: '<p>ab\u{1F600}cd efgh</p>', cfi: 'epubcfi(/6/2!/4/2/1:4)', pos: '/body/DocFragment[1]/body/p/text().3', index: 0 },
    { body: '<p>\n    Hello   world\n  </p>', cfi: 'epubcfi(/6/2!/4/2/1:13)', pos: '/body/DocFragment[1]/body/p/text().7', index: 0 },
    { body: '<p> Leading text.</p>', cfi: 'epubcfi(/6/2!/4/2/1:5)', pos: '/body/DocFragment[1]/body/p/text().5', index: 0 },
    { body: '<p>\n    Leading text.</p>', cfi: 'epubcfi(/6/2!/4/2/1:9)', pos: '/body/DocFragment[1]/body/p/text().5', index: 0 },
    { body: '<p>a\u00a0\u00a0bc</p>', cfi: 'epubcfi(/6/2!/4/2/1:3)', pos: '/body/DocFragment[1]/body/p/text().3', index: 0 },
    { body: '<p>a\u2003\u2003bc</p>', cfi: 'epubcfi(/6/2!/4/2/1:3)', pos: '/body/DocFragment[1]/body/p/text().3', index: 0 },
    { body: '<p>ab\u{1F600}</p>', cfi: 'epubcfi(/6/2!/4/2/1:4)', pos: '/body/DocFragment[1]/body/p/text().3', index: 0 },
    { body: '<div><img src="page.png"/></div>', cfi: 'epubcfi(/6/2!/4/2/2)', pos: '/body/DocFragment[1]/body/div/img', index: 0 },
    { body: '<p>Text</p>', cfi: 'epubcfi(/6/2!/4/2)', pos: '/body/DocFragment[1]/body/p', index: 0 },
    {
      body: '<div>\n<p>First</p>\n<p>Second</p>\nThird<br/> fourth</div>',
      cfi: 'epubcfi(/6/2!/4/2/7:3)',
      pos: '/body/DocFragment[1]/body/div/text()[2].3',
      index: 0,
    },
  ])('preserves the text point in $cfi and round trips it', async ({ body, cfi, pos, index }) => {
    const { service, epubDom } = makeService({ 10: chapter(body) });
    await expect(service.cfiPointToXpointer({ bookFileId: 10, cfi })).resolves.toEqual({ status: 'exact', pos0: pos, chapterIndex: index });
    expect(epubDom.getChapter).toHaveBeenCalledWith(10, index);
    await expect(service.xpointerPointToCfi({ bookFileId: 10, pos })).resolves.toEqual({ status: 'exact', cfi, chapterIndex: index });
  });

  it('converts the explicit singleton indexes emitted after CREngine page turns', async () => {
    const { service } = makeService({ 10: chapter('<div><p>First paragraph.</p><p>Second paragraph.</p></div>') });
    await expect(service.xpointerPointToCfi({ bookFileId: 10, pos: '/body[1]/DocFragment[1]/body[1]/div[1]/p[2]/text()[1].7' })).resolves.toEqual({
      status: 'exact',
      cfi: 'epubcfi(/6/2!/4/2/4/1:7)',
      chapterIndex: 0,
    });
  });

  it('rejects an invalid root body index', async () => {
    const { service } = makeService({ 10: chapter('<p>Text</p>') });
    await expect(service.xpointerPointToCfi({ bookFileId: 10, pos: '/body[2]/DocFragment[1]/body/p/text().1' })).resolves.toMatchObject({
      status: 'failed',
    });
  });

  it.each([
    { source: 'word '.repeat(2000), rawOffset: 9000, engineOffset: 810 },
    { source: 'word&amp; '.repeat(1100), rawOffset: 6300, engineOffset: 1386 },
    { source: 'a'.repeat(8200), rawOffset: 8195, engineOffset: 3 },
    { source: 'word '.repeat(4000), rawOffset: 17000, engineOffset: 620 },
  ])('maps source-parser text chunks in long paragraphs at $rawOffset', async ({ source, rawOffset, engineOffset }) => {
    const { service } = makeService({ 10: chapter(`<p>${source}</p>`) });
    const converted = await service.cfiPointToXpointer({ bookFileId: 10, cfi: `epubcfi(/6/2!/4/2/1:${rawOffset})` });
    const textIndex = rawOffset === 17000 ? 3 : 2;
    expect(converted).toEqual({ status: 'exact', pos0: `/body/DocFragment[1]/body/p/text()[${textIndex}].${engineOffset}`, chapterIndex: 0 });
    await expect(service.xpointerPointToCfi({ bookFileId: 10, pos: converted.status === 'failed' ? '' : converted.pos0! })).resolves.toEqual({
      status: 'exact',
      cfi: `epubcfi(/6/2!/4/2/1:${rawOffset})`,
      chapterIndex: 0,
    });
  });

  it('resolves paragraph 40 in the issue 1621 reproduction instead of the chapter start', async () => {
    const body = '<h1>Chapter One</h1>' + Array.from({ length: 100 }, (_, i) => `<p>${`Paragraph ${i + 1}. `.repeat(20)}</p>`).join('');
    const { service } = makeService({ 10: chapter(body) });
    await expect(service.cfiPointToXpointer({ bookFileId: 10, cfi: 'epubcfi(/6/2!/4/82/1:50)' })).resolves.toEqual({
      status: 'exact',
      pos0: '/body/DocFragment[1]/body/p[40]/text().50',
      chapterIndex: 0,
    });
  });

  it('rejects a text-node index removed by CREngine instead of choosing a different node', async () => {
    const { service } = makeService({ 10: chapter('<div>\n<p>First</p>\nThird</div>') });
    await expect(service.xpointerPointToCfi({ bookFileId: 10, pos: '/body/DocFragment[1]/body/div/text()[2].1' })).resolves.toMatchObject({
      status: 'failed',
    });
  });

  it('rejects an offset beyond the engine text node', async () => {
    const { service } = makeService({ 10: chapter('<p>Text</p>') });
    await expect(service.xpointerPointToCfi({ bookFileId: 10, pos: '/body/DocFragment[1]/body/p/text().5' })).resolves.toMatchObject({
      status: 'failed',
    });
  });

  it('converts the zero-offset element pointer CREngine emits for an image', async () => {
    const { service } = makeService({ 10: chapter('<div><img src="page.png"/></div>') });
    await expect(service.xpointerPointToCfi({ bookFileId: 10, pos: '/body/DocFragment[1]/body/div/img.0' })).resolves.toEqual({
      status: 'exact',
      cfi: 'epubcfi(/6/2!/4/2/2)',
      chapterIndex: 0,
    });
  });

  it.each([
    { cfi: 'tts:0:40', reason: 'missing_spine_step' },
    { cfi: 'epubcfi(/4/2/1:3)', reason: 'missing_spine_step' },
    { cfi: 'epubcfi(/6/2!/4/999/1:3)', reason: 'unresolvable_structure', chapterIndex: 0 },
  ])('fails explicitly for $cfi', async ({ cfi, reason, chapterIndex }) => {
    const { service } = makeService({ 10: chapter('<p>Text</p>') });
    await expect(service.cfiPointToXpointer({ bookFileId: 10, cfi })).resolves.toEqual({
      status: 'failed',
      reason,
      ...(chapterIndex === undefined ? {} : { chapterIndex }),
    });
  });

  it('does not manufacture a position when the requested chapter is unavailable', async () => {
    const { service } = makeService({});
    await expect(service.cfiPointToXpointer({ bookFileId: 10, cfi: 'epubcfi(/6/8!/4/2/1:3)' })).resolves.toEqual({
      status: 'failed',
      reason: 'chapter_unavailable',
      chapterIndex: 3,
    });
  });
});
