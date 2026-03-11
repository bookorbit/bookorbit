import { CbzFormatWriter } from './cbz-format-writer';
import type { MockedFunction } from 'vitest';
import { buildComicInfoXml } from './comic-info-builder';
import { readComicInfoFromZip, writeComicInfoToZip } from './cbz-zip-patcher';

vi.mock('./comic-info-builder', () => ({
  buildComicInfoXml: vi.fn(),
}));

vi.mock('./cbz-zip-patcher', () => ({
  readComicInfoFromZip: vi.fn(),
  writeComicInfoToZip: vi.fn(),
}));

const mockBuildComicInfoXml = buildComicInfoXml as MockedFunction<typeof buildComicInfoXml>;
const mockReadComicInfoFromZip = readComicInfoFromZip as MockedFunction<typeof readComicInfoFromZip>;
const mockWriteComicInfoToZip = writeComicInfoToZip as MockedFunction<typeof writeComicInfoToZip>;

describe('CbzFormatWriter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    const result = await writer.write('/book.cbz', { title: 'Dune', tags: ['classic'] }, { fieldMask: new Set(['title', 'tags']), dryRun: false });

    expect(mockReadComicInfoFromZip).toHaveBeenCalledWith('/book.cbz');
    expect(mockBuildComicInfoXml).toHaveBeenCalledWith('<ComicInfo/>', { title: 'Dune', tags: ['classic'] }, new Set(['title', 'tags']));
    expect(mockWriteComicInfoToZip).toHaveBeenCalledWith('/book.cbz', '<ComicInfo><Title>Dune</Title></ComicInfo>');
    expect(result.status).toBe('success');
    expect(result.fieldsWritten).toEqual(['title', 'tags']);
  });
});
