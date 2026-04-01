import { readFile, rename, unlink, writeFile } from 'fs/promises';
import type { MockedFunction } from 'vitest';
import { randomUUID } from 'crypto';

import { Cb7FormatWriter } from './cb7-format-writer';
import { getSevenZip } from '../../../../common/sevenzip';
import { buildComicInfoXml } from './comic-info-builder';

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual('fs/promises');
  return {
    ...actual,
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
  };
});

vi.mock('crypto', async () => {
  const actual = await vi.importActual('crypto');
  return {
    ...actual,
    randomUUID: vi.fn(),
  };
});

vi.mock('../../../../common/sevenzip', () => ({
  getSevenZip: vi.fn(),
}));

vi.mock('./comic-info-builder', () => ({
  buildComicInfoXml: vi.fn(),
}));

const mockReadFile = readFile as MockedFunction<typeof readFile>;
const mockWriteFile = writeFile as MockedFunction<typeof writeFile>;
const mockRename = rename as MockedFunction<typeof rename>;
const mockUnlink = unlink as MockedFunction<typeof unlink>;
const mockRandomUuid = randomUUID as MockedFunction<typeof randomUUID>;
const mockGetSevenZip = getSevenZip as MockedFunction<typeof getSevenZip>;
const mockBuildComicInfoXml = buildComicInfoXml as MockedFunction<typeof buildComicInfoXml>;

describe('Cb7FormatWriter', () => {
  function makeSevenZip(extractExists = true) {
    const fsApi = {
      open: vi.fn().mockReturnValue(1),
      write: vi.fn(),
      close: vi.fn(),
      mkdir: vi.fn(),
      readdir: vi.fn().mockReturnValue(['.', '..', 'ComicInfo.xml']),
      readFile: vi.fn((path: string) => {
        if (path.includes('/cbx-ext-')) return Buffer.from('<ComicInfo><Title>Old</Title></ComicInfo>');
        return Buffer.from('modified-archive-bytes');
      }),
      unlink: vi.fn(),
      rmdir: vi.fn(),
    };

    const callMain = vi.fn((args: string[]) => {
      if (!extractExists && args[0] === 'e') throw new Error('not found');
    });

    return { FS: fsApi, callMain };
  }

  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(sz.callMain).toHaveBeenCalledWith(['d', '/cbx-arc-abcdef123.cb7', 'ComicInfo.xml', '-y']);
    expect(sz.callMain).toHaveBeenCalledWith(['a', '/cbx-arc-abcdef123.cb7', '/ComicInfo.xml']);
    expect(mockWriteFile).toHaveBeenCalledWith('/.cbx-write-abcdef123', Buffer.from('modified-archive-bytes'));
    expect(mockRename).toHaveBeenCalledWith('/.cbx-write-abcdef123', '/book.cb7');
    expect(result.status).toBe('success');
  });

  it('falls back to fresh xml when archive has no ComicInfo.xml and cleans temp on rename failure', async () => {
    const sz = makeSevenZip(false);
    mockGetSevenZip.mockResolvedValue(sz as never);
    mockRename.mockRejectedValue(new Error('rename denied'));

    const writer = new Cb7FormatWriter();

    await expect(writer.write('/book.cb7', { title: 'Dune' }, { fieldMask: new Set(['title']), dryRun: false })).rejects.toThrow('rename denied');

    expect(mockBuildComicInfoXml).toHaveBeenCalledWith(null, { title: 'Dune' }, new Set(['title']));
    expect(mockUnlink).toHaveBeenCalledWith('/.cbx-write-abcdef123');
    expect(sz.FS.rmdir).toHaveBeenCalledWith('/cbx-ext-abcdef123');
  });
});
