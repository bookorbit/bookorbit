import { EpubFormatWriter } from './epub-format-writer';
import { locateOpf } from './epub-opf-locator';
import * as EpubZipPatcher from './epub-zip-patcher';
import { build as buildOpf } from './epub-opf-builder';
import * as EpubCoverHandler from './epub-cover-handler';

jest.mock('./epub-opf-locator', () => ({
  locateOpf: jest.fn(),
}));

jest.mock('./epub-zip-patcher', () => ({
  readEntry: jest.fn(),
  patch: jest.fn(),
}));

jest.mock('./epub-opf-builder', () => ({
  build: jest.fn(),
}));

jest.mock('./epub-cover-handler', () => ({
  locate: jest.fn(),
  inject: jest.fn(),
}));

const mockLocateOpf = locateOpf as jest.MockedFunction<typeof locateOpf>;
const mockReadEntry = EpubZipPatcher.readEntry as jest.MockedFunction<typeof EpubZipPatcher.readEntry>;
const mockPatch = EpubZipPatcher.patch as jest.MockedFunction<typeof EpubZipPatcher.patch>;
const mockBuildOpf = buildOpf as jest.MockedFunction<typeof buildOpf>;
const mockCoverLocate = EpubCoverHandler.locate as jest.MockedFunction<typeof EpubCoverHandler.locate>;
const mockCoverInject = EpubCoverHandler.inject as jest.MockedFunction<typeof EpubCoverHandler.inject>;

describe('EpubFormatWriter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocateOpf.mockResolvedValue({ opfPath: 'OPS/content.opf', opfDir: 'OPS/' });
    mockReadEntry.mockResolvedValue('<package />');
    mockBuildOpf.mockReturnValue({ newOpfXml: '<package>new</package>', fieldsWritten: ['title'] });
  });

  it('returns dry-run result without patching zip', async () => {
    const writer = new EpubFormatWriter();

    const result = await writer.write('/book.epub', { title: 'Dune' }, { fieldMask: new Set(['title']), dryRun: true });

    expect(result).toMatchObject({ status: 'skipped', reason: 'dry-run', fieldsWritten: ['title'] });
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('updates existing cover slot when cover bytes are provided', async () => {
    const writer = new EpubFormatWriter();

    mockCoverLocate.mockReturnValue({ entryPath: 'OPS/images/cover.jpg', mediaType: 'image/jpeg' });

    const coverBytes = Buffer.from('cover');

    const result = await writer.write(
      '/book.epub',
      { title: 'Dune', coverBytes },
      { fieldMask: new Set(['title', 'coverBytes']), dryRun: false },
    );

    expect(mockCoverLocate).toHaveBeenCalledWith('<package />', 'OPS/');
    expect(mockPatch).toHaveBeenCalledWith(
      '/book.epub',
      expect.any(Map),
    );

    const patches = mockPatch.mock.calls[0][1];
    expect(patches.get('OPS/content.opf')).toEqual(Buffer.from('<package>new</package>'));
    expect(patches.get('OPS/images/cover.jpg')).toBe(coverBytes);
    expect(result.fieldsWritten).toEqual(['title', 'coverBytes']);
    expect(result.status).toBe('success');
  });

  it('injects new cover when no cover slot exists', async () => {
    const writer = new EpubFormatWriter();

    mockCoverLocate.mockReturnValue(null);
    mockCoverInject.mockReturnValue({
      updatedOpfXml: '<package>with-cover</package>',
      newEntryPath: 'OPS/images/cover.png',
    });

    const coverBytes = Buffer.from([1, 2, 3]);

    await writer.write(
      '/book.epub',
      { title: 'Dune', coverBytes },
      { fieldMask: new Set(['title', 'coverBytes']), dryRun: false },
    );

    expect(mockCoverInject).toHaveBeenCalledWith('<package>new</package>', 'OPS/', coverBytes);

    const patches = mockPatch.mock.calls[0][1];
    expect(patches.get('OPS/content.opf')).toEqual(Buffer.from('<package>with-cover</package>'));
    expect(patches.get('OPS/images/cover.png')).toEqual(coverBytes);
  });
});
