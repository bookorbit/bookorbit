import { readFile, rename, unlink, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';

import { Cb7FormatWriter } from './cb7-format-writer';
import { getSevenZip } from '../../../../common/sevenzip';
import { buildComicInfoXml } from './comic-info-builder';

jest.mock('fs/promises', () => {
  const actual = jest.requireActual('fs/promises');
  return {
    ...actual,
    readFile: jest.fn(),
    writeFile: jest.fn(),
    rename: jest.fn(),
    unlink: jest.fn(),
  };
});

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return {
    ...actual,
    randomUUID: jest.fn(),
  };
});

jest.mock('../../../../common/sevenzip', () => ({
  getSevenZip: jest.fn(),
}));

jest.mock('./comic-info-builder', () => ({
  buildComicInfoXml: jest.fn(),
}));

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockRename = rename as jest.MockedFunction<typeof rename>;
const mockUnlink = unlink as jest.MockedFunction<typeof unlink>;
const mockRandomUuid = randomUUID as jest.MockedFunction<typeof randomUUID>;
const mockGetSevenZip = getSevenZip as jest.MockedFunction<typeof getSevenZip>;
const mockBuildComicInfoXml = buildComicInfoXml as jest.MockedFunction<typeof buildComicInfoXml>;

describe('Cb7FormatWriter', () => {
  function makeSevenZip(extractExists = true) {
    const fsApi = {
      open: jest.fn().mockReturnValue(1),
      write: jest.fn(),
      close: jest.fn(),
      mkdir: jest.fn(),
      readdir: jest.fn().mockReturnValue(['.', '..', 'ComicInfo.xml']),
      readFile: jest.fn((path: string) => {
        if (path.includes('/cbx-ext-')) return Buffer.from('<ComicInfo><Title>Old</Title></ComicInfo>');
        return Buffer.from('modified-archive-bytes');
      }),
      unlink: jest.fn(),
      rmdir: jest.fn(),
    };

    const callMain = jest.fn((args: string[]) => {
      if (!extractExists && args[0] === 'e') throw new Error('not found');
    });

    return { FS: fsApi, callMain };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockRandomUuid.mockReturnValue('abc-def-123');
    mockReadFile.mockResolvedValue(Buffer.from('archive-bytes') as never);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockBuildComicInfoXml.mockReturnValue('<ComicInfo><Title>New</Title></ComicInfo>');
  });

  it('returns dry-run skip without touching filesystem', async () => {
    const writer = new Cb7FormatWriter();

    const result = await writer.write('/book.cb7', { title: 'Dune' }, { fieldMask: new Set(['title']), dryRun: true });

    expect(result).toMatchObject({ status: 'skipped', reason: 'dry-run', fieldsWritten: ['title'] });
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockGetSevenZip).not.toHaveBeenCalled();
  });

  it('updates archive and writes rebuilt ComicInfo.xml', async () => {
    const sz = makeSevenZip(true);
    mockGetSevenZip.mockResolvedValue(sz as never);

    const writer = new Cb7FormatWriter();

    const result = await writer.write('/book.cb7', { title: 'Dune' }, { fieldMask: new Set(['title']), dryRun: false });

    expect(mockBuildComicInfoXml).toHaveBeenCalledWith('<ComicInfo><Title>Old</Title></ComicInfo>', { title: 'Dune' }, new Set(['title']));
    expect(sz.callMain).toHaveBeenCalledWith(['d', '/cbx-arc-abcdef123', 'ComicInfo.xml', '-y']);
    expect(sz.callMain).toHaveBeenCalledWith(['a', '/cbx-arc-abcdef123', '/ComicInfo.xml']);
    expect(mockWriteFile).toHaveBeenCalledWith('/.cbx-write-abcdef123', Buffer.from('modified-archive-bytes'));
    expect(mockRename).toHaveBeenCalledWith('/.cbx-write-abcdef123', '/book.cb7');
    expect(result.status).toBe('success');
  });

  it('falls back to fresh xml when archive has no ComicInfo.xml and cleans temp on rename failure', async () => {
    const sz = makeSevenZip(false);
    mockGetSevenZip.mockResolvedValue(sz as never);
    mockRename.mockRejectedValue(new Error('rename denied'));

    const writer = new Cb7FormatWriter();

    await expect(
      writer.write('/book.cb7', { title: 'Dune' }, { fieldMask: new Set(['title']), dryRun: false }),
    ).rejects.toThrow('rename denied');

    expect(mockBuildComicInfoXml).toHaveBeenCalledWith(null, { title: 'Dune' }, new Set(['title']));
    expect(mockUnlink).toHaveBeenCalledWith('/.cbx-write-abcdef123');
    expect(sz.FS.rmdir).toHaveBeenCalledWith('/cbx-ext-abcdef123');
  });
});
