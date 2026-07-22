import type { MockedFunction } from 'vitest';

import * as EpubCoverHandler from './epub-cover-handler';
import { inspectCoverImage } from './epub-cover-image';
import { EpubFormatWriter } from './epub-format-writer';
import { build as buildOpf } from './epub-opf-builder';
import { locateOpf } from './epub-opf-locator';
import * as EpubZipPatcher from './epub-zip-patcher';

vi.mock('./epub-opf-locator', () => ({
  locateOpf: vi.fn(),
}));

vi.mock('./epub-zip-patcher', () => ({
  readEntry: vi.fn(),
  listEntryPaths: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('./epub-opf-builder', () => ({
  build: vi.fn(),
}));

vi.mock('./epub-cover-handler', () => ({
  locate: vi.fn(),
  replace: vi.fn(),
  inject: vi.fn(),
}));

vi.mock('./epub-cover-image', () => ({
  inspectCoverImage: vi.fn(),
}));

const mockLocateOpf = locateOpf as MockedFunction<typeof locateOpf>;
const mockReadEntry = EpubZipPatcher.readEntry as MockedFunction<typeof EpubZipPatcher.readEntry>;
const mockListEntryPaths = EpubZipPatcher.listEntryPaths as MockedFunction<typeof EpubZipPatcher.listEntryPaths>;
const mockPatch = EpubZipPatcher.patch as MockedFunction<typeof EpubZipPatcher.patch>;
const mockBuildOpf = buildOpf as MockedFunction<typeof buildOpf>;
const mockCoverLocate = EpubCoverHandler.locate as MockedFunction<typeof EpubCoverHandler.locate>;
const mockCoverReplace = EpubCoverHandler.replace as MockedFunction<typeof EpubCoverHandler.replace>;
const mockCoverInject = EpubCoverHandler.inject as MockedFunction<typeof EpubCoverHandler.inject>;
const mockInspectCoverImage = inspectCoverImage as MockedFunction<typeof inspectCoverImage>;

describe('EpubFormatWriter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocateOpf.mockResolvedValue({ opfPath: 'OPS/content.opf', opfDir: 'OPS/' });
    mockReadEntry.mockResolvedValue('<package />');
    mockListEntryPaths.mockResolvedValue(['mimetype', 'OPS/content.opf', 'OPS/images/cover.jpg']);
    mockBuildOpf.mockReturnValue({ newOpfXml: '<package>new</package>', fieldsWritten: ['title'] });
    mockCoverLocate.mockResolvedValue(null);
    mockInspectCoverImage.mockResolvedValue({ mediaType: 'image/jpeg', extension: 'jpg' });
  });

  it('returns dry-run result without patching zip', async () => {
    const writer = new EpubFormatWriter();

    const result = await writer.write('/book.epub', { title: 'Dune' }, { fieldMask: new Set(['title']), dryRun: true });

    expect(result).toMatchObject({ status: 'skipped', reason: 'dry-run', fieldsWritten: ['title'] });
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('writes the exact selected bytes to an existing cover slot', async () => {
    const writer = new EpubFormatWriter();
    const slot = { entryPath: 'OPS/images/cover.jpg', mediaType: 'image/jpeg', manifestItemId: 'cover' };
    const coverBytes = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x02]);
    mockCoverLocate.mockResolvedValue(slot);
    mockCoverReplace.mockReturnValue({ updatedOpfXml: '<package>new</package>', newEntryPath: 'OPS/images/cover.jpg' });

    const result = await writer.write('/book.epub', { title: 'Dune', coverBytes }, { fieldMask: new Set(['title', 'coverBytes']), dryRun: false });

    expect(mockCoverLocate).toHaveBeenCalledWith('<package />', 'OPS/', expect.any(Function));
    expect(mockInspectCoverImage).toHaveBeenCalledWith(coverBytes);
    expect(mockCoverReplace).toHaveBeenCalledWith('<package>new</package>', 'OPS/', slot, { mediaType: 'image/jpeg', extension: 'jpg' }, [
      'mimetype',
      'OPS/content.opf',
      'OPS/images/cover.jpg',
    ]);
    expect(mockPatch).toHaveBeenCalledWith('/book.epub', expect.any(Map));

    const patches = mockPatch.mock.calls[0][1];
    expect(patches.get('OPS/content.opf')).toEqual(Buffer.from('<package>new</package>'));
    expect(patches.get('OPS/images/cover.jpg')).toBe(coverBytes);
    expect(result).toMatchObject({ status: 'success', fieldsWritten: ['title', 'coverBytes'] });
  });

  it('writes updated OPF and cover-page references while preserving selected bytes', async () => {
    const writer = new EpubFormatWriter();
    const coverBytes = Buffer.from('exact-webp-file');
    mockInspectCoverImage.mockResolvedValue({ mediaType: 'image/webp', extension: 'webp' });
    mockCoverLocate.mockResolvedValue({
      entryPath: 'OPS/images/cover.jpg',
      mediaType: 'image/jpeg',
      manifestItemId: 'cover-art',
      document: {
        entryPath: 'OPS/text/cover.xhtml',
        xml: '<img src="../images/cover.jpg" />',
        imageHref: '../images/cover.jpg',
      },
    });
    mockCoverReplace.mockReturnValue({
      updatedOpfXml: '<package>webp-cover</package>',
      newEntryPath: 'OPS/images/cover.webp',
      documentPatch: { entryPath: 'OPS/text/cover.xhtml', xml: '<img src="../images/cover.webp" />' },
    });

    await writer.write('/book.epub', { coverBytes }, { fieldMask: new Set(['coverBytes']), dryRun: false });

    const patches = mockPatch.mock.calls[0][1];
    expect(patches.get('OPS/content.opf')).toEqual(Buffer.from('<package>webp-cover</package>'));
    expect(patches.get('OPS/text/cover.xhtml')).toEqual(Buffer.from('<img src="../images/cover.webp" />'));
    expect(patches.get('OPS/images/cover.webp')).toBe(coverBytes);
    expect(patches.has('OPS/images/cover.jpg')).toBe(false);
  });

  it('injects a cover using the selected image format when no cover slot exists', async () => {
    const writer = new EpubFormatWriter();
    const coverBytes = Buffer.from('exact-webp-file');
    mockInspectCoverImage.mockResolvedValue({ mediaType: 'image/webp', extension: 'webp' });
    mockCoverInject.mockReturnValue({
      updatedOpfXml: '<package>with-cover</package>',
      newEntryPath: 'OPS/images/bookorbit-cover.webp',
    });

    await writer.write('/book.epub', { title: 'Dune', coverBytes }, { fieldMask: new Set(['title', 'coverBytes']), dryRun: false });

    expect(mockCoverInject).toHaveBeenCalledWith('<package>new</package>', 'OPS/', { mediaType: 'image/webp', extension: 'webp' }, [
      'mimetype',
      'OPS/content.opf',
      'OPS/images/cover.jpg',
    ]);
    const patches = mockPatch.mock.calls[0][1];
    expect(patches.get('OPS/content.opf')).toEqual(Buffer.from('<package>with-cover</package>'));
    expect(patches.get('OPS/images/bookorbit-cover.webp')).toBe(coverBytes);
  });

  it('falls back to injection when an existing cover cannot be safely updated', async () => {
    const writer = new EpubFormatWriter();
    const coverBytes = Buffer.from('exact-image-file');
    mockCoverLocate.mockResolvedValue({ entryPath: 'OPS/cover.jpg', mediaType: 'image/jpeg', manifestItemId: 'missing' });
    mockCoverReplace.mockReturnValue(null);
    mockCoverInject.mockReturnValue({
      updatedOpfXml: '<package>with-fallback-cover</package>',
      newEntryPath: 'OPS/images/bookorbit-cover.jpg',
    });

    await writer.write('/book.epub', { coverBytes }, { fieldMask: new Set(['coverBytes']), dryRun: false });

    expect(mockCoverInject).toHaveBeenCalledTimes(1);
    const patches = mockPatch.mock.calls[0][1];
    expect(patches.get('OPS/images/bookorbit-cover.jpg')).toBe(coverBytes);
  });
});
