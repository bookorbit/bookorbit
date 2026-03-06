import { CbzFormatWriter } from './cbz-format-writer';
import { buildComicInfoXml } from './comic-info-builder';
import { readComicInfoFromZip, writeComicInfoToZip } from './cbz-zip-patcher';

jest.mock('./comic-info-builder', () => ({
  buildComicInfoXml: jest.fn(),
}));

jest.mock('./cbz-zip-patcher', () => ({
  readComicInfoFromZip: jest.fn(),
  writeComicInfoToZip: jest.fn(),
}));

const mockBuildComicInfoXml = buildComicInfoXml as jest.MockedFunction<typeof buildComicInfoXml>;
const mockReadComicInfoFromZip = readComicInfoFromZip as jest.MockedFunction<typeof readComicInfoFromZip>;
const mockWriteComicInfoToZip = writeComicInfoToZip as jest.MockedFunction<typeof writeComicInfoToZip>;

describe('CbzFormatWriter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns dry-run skip without touching archive', async () => {
    const writer = new CbzFormatWriter();

    const result = await writer.write('/book.cbz', { title: 'Dune' }, { fieldMask: new Set(['title']), dryRun: true });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('dry-run');
    expect(result.fieldsWritten).toEqual(['title']);
    expect(mockReadComicInfoFromZip).not.toHaveBeenCalled();
    expect(mockWriteComicInfoToZip).not.toHaveBeenCalled();
  });

  it('reads existing xml, rebuilds it, and patches archive', async () => {
    const writer = new CbzFormatWriter();

    mockReadComicInfoFromZip.mockResolvedValue('<ComicInfo/>');
    mockBuildComicInfoXml.mockReturnValue('<ComicInfo><Title>Dune</Title></ComicInfo>');
    mockWriteComicInfoToZip.mockResolvedValue(undefined);

    const result = await writer.write(
      '/book.cbz',
      { title: 'Dune', tags: ['classic'] },
      { fieldMask: new Set(['title', 'tags']), dryRun: false },
    );

    expect(mockReadComicInfoFromZip).toHaveBeenCalledWith('/book.cbz');
    expect(mockBuildComicInfoXml).toHaveBeenCalledWith('<ComicInfo/>', { title: 'Dune', tags: ['classic'] }, new Set(['title', 'tags']));
    expect(mockWriteComicInfoToZip).toHaveBeenCalledWith('/book.cbz', '<ComicInfo><Title>Dune</Title></ComicInfo>');
    expect(result.status).toBe('success');
    expect(result.fieldsWritten).toEqual(['title', 'tags']);
  });
});
