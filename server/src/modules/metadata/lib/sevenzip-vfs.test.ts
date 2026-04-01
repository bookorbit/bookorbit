import { cleanupSevenZipArtifacts, createSevenZipTempId } from './sevenzip-vfs';

describe('sevenzip-vfs', () => {
  it('creates prefixed unique temp ids', () => {
    const id = createSevenZipTempId('cover');
    expect(id.startsWith('cover_')).toBe(true);
    expect(id.length).toBeGreaterThan('cover_'.length);
  });

  it('cleans extracted files, output directory, and archive path', () => {
    const fsApi = {
      readdir: vi.fn().mockReturnValue(['.', '..', 'ComicInfo.xml']),
      unlink: vi.fn(),
      rmdir: vi.fn(),
    };

    cleanupSevenZipArtifacts({ FS: fsApi } as any, '/archive.7z', '/out');

    expect(fsApi.unlink).toHaveBeenCalledWith('/out/ComicInfo.xml');
    expect(fsApi.rmdir).toHaveBeenCalledWith('/out');
    expect(fsApi.unlink).toHaveBeenCalledWith('/archive.7z');
  });

  it('still tries deleting archive when output directory cleanup fails', () => {
    const fsApi = {
      readdir: vi.fn().mockImplementation(() => {
        throw new Error('missing directory');
      }),
      unlink: vi.fn(),
      rmdir: vi.fn(),
    };

    cleanupSevenZipArtifacts({ FS: fsApi } as any, '/archive.7z', '/out');

    expect(fsApi.unlink).toHaveBeenCalledWith('/archive.7z');
  });
});
