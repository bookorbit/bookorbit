import { Logger } from '@nestjs/common';

import { KoboProgressBridgeService } from './kobo-progress-bridge.service';

describe('KoboProgressBridgeService', () => {
  const kepubContextService = { resolveForBook: vi.fn() };
  const koboSpanConverter = { koboBookmarkToPositions: vi.fn(), cfiPointToKoboBookmark: vi.fn() };
  let warnSpy: ReturnType<typeof vi.spyOn>;

  const readyContext = { ok: true, file: { id: 55 }, settings: {}, ctx: { kepubPath: '/cache/book.kepub.epub' } };

  function makeService() {
    return new KoboProgressBridgeService(kepubContextService as never, koboSpanConverter as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('cfiToKoboBookmark', () => {
    it('maps a converted point onto the Kobo bookmark fields', async () => {
      kepubContextService.resolveForBook.mockResolvedValue(readyContext);
      koboSpanConverter.cfiPointToKoboBookmark.mockResolvedValue({
        status: 'exact',
        spanId: 'kobo.31.1',
        chapterFilename: 'OEBPS/ch7.xhtml',
        contentSourceProgressPercent: 12.5,
      });

      await expect(makeService().cfiToKoboBookmark(1, 44, 'epubcfi(/6/8!/4/2/2/1:0)')).resolves.toEqual({
        source: 'OEBPS/ch7.xhtml',
        value: 'kobo.31.1',
        contentSourceProgressPercent: 12.5,
      });
      expect(koboSpanConverter.cfiPointToKoboBookmark).toHaveBeenCalledWith({
        bookFileId: 55,
        ctx: readyContext.ctx,
        cfi: 'epubcfi(/6/8!/4/2/2/1:0)',
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('defaults a missing source-level percent to null rather than dropping the point', async () => {
      kepubContextService.resolveForBook.mockResolvedValue(readyContext);
      koboSpanConverter.cfiPointToKoboBookmark.mockResolvedValue({ status: 'repaired', spanId: 'kobo.4.1', chapterFilename: 'OEBPS/ch1.xhtml' });

      await expect(makeService().cfiToKoboBookmark(1, 44, 'epubcfi(/6/2!/4/2/1:0)')).resolves.toEqual({
        source: 'OEBPS/ch1.xhtml',
        value: 'kobo.4.1',
        contentSourceProgressPercent: null,
      });
    });

    // Without a Location the device gets a percent it cannot resume from, so the reason the
    // conversion gave up has to reach the logs; it used to be swallowed entirely.
    it('warns with the readiness reason when no kepub context is available', async () => {
      kepubContextService.resolveForBook.mockResolvedValue({ ok: false, reason: 'kepub_required', settings: null });

      await expect(makeService().cfiToKoboBookmark(1, 44, 'epubcfi(/6/8!/4/2/2/1:0)')).resolves.toBeNull();

      expect(koboSpanConverter.cfiPointToKoboBookmark).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[kobo.progress_bridge] [fail] op=cfi_to_bookmark userId=1 bookId=44 reason=kepub_required'),
      );
    });

    it('warns with the converter reason when the span lookup fails', async () => {
      kepubContextService.resolveForBook.mockResolvedValue(readyContext);
      koboSpanConverter.cfiPointToKoboBookmark.mockResolvedValue({ status: 'failed', reason: 'missing_spine_step' });

      await expect(makeService().cfiToKoboBookmark(1, 44, 'epubcfi(/4/2)')).resolves.toBeNull();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('reason=missing_spine_step'));
    });

    it('warns when the converter reports success without a usable span', async () => {
      kepubContextService.resolveForBook.mockResolvedValue(readyContext);
      koboSpanConverter.cfiPointToKoboBookmark.mockResolvedValue({ status: 'exact', spanId: 'kobo.4.1' });

      await expect(makeService().cfiToKoboBookmark(1, 44, 'epubcfi(/6/2!/4/2/1:0)')).resolves.toBeNull();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('reason=incomplete_outcome'));
    });

    it('degrades to null and logs the error class when the converter throws', async () => {
      kepubContextService.resolveForBook.mockRejectedValue(new TypeError('kepub cache unreadable'));

      await expect(makeService().cfiToKoboBookmark(1, 44, 'epubcfi(/6/2!/4/2/1:0)')).resolves.toBeNull();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('errorClass=TypeError'));
    });
  });

  describe('koboBookmarkToCanonical', () => {
    it('returns the canonical pair for a resolved device bookmark', async () => {
      kepubContextService.resolveForBook.mockResolvedValue(readyContext);
      koboSpanConverter.koboBookmarkToPositions.mockResolvedValue({
        status: 'exact',
        cfi: 'epubcfi(/6/8!/4/2/2/1:0)',
        xpointer: '/body/DocFragment[4]/body/p[2]/text()[1].0',
      });

      await expect(makeService().koboBookmarkToCanonical(1, 44, 'OEBPS/ch7.xhtml', 'kobo.31.1')).resolves.toEqual({
        cfi: 'epubcfi(/6/8!/4/2/2/1:0)',
        xpointer: '/body/DocFragment[4]/body/p[2]/text()[1].0',
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('warns with the converter reason when the chapter cannot be resolved', async () => {
      kepubContextService.resolveForBook.mockResolvedValue(readyContext);
      koboSpanConverter.koboBookmarkToPositions.mockResolvedValue({ status: 'failed', reason: 'chapter_not_found' });

      await expect(makeService().koboBookmarkToCanonical(1, 44, 'OEBPS/gone.xhtml', 'kobo.31.1')).resolves.toBeNull();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[kobo.progress_bridge] [fail] op=bookmark_to_canonical userId=1 bookId=44 reason=chapter_not_found'),
      );
    });

    it('warns when the outcome carries no xpointer', async () => {
      kepubContextService.resolveForBook.mockResolvedValue(readyContext);
      koboSpanConverter.koboBookmarkToPositions.mockResolvedValue({ status: 'exact', cfi: 'epubcfi(/6/8!/4/2)' });

      await expect(makeService().koboBookmarkToCanonical(1, 44, 'OEBPS/ch7.xhtml', 'kobo.31.1')).resolves.toBeNull();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('reason=incomplete_outcome'));
    });
  });
});
