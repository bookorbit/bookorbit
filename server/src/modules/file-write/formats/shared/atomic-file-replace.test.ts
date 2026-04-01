import { rename, unlink } from 'fs/promises';
import type { MockedFunction } from 'vitest';

import { replaceFileAtomically } from './atomic-file-replace';

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual('fs/promises');
  return {
    ...actual,
    rename: vi.fn(),
    unlink: vi.fn(),
  };
});

const mockRename = rename as MockedFunction<typeof rename>;
const mockUnlink = unlink as MockedFunction<typeof unlink>;

describe('replaceFileAtomically', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renames file when target replacement succeeds', async () => {
    mockRename.mockResolvedValue(undefined);

    await expect(replaceFileAtomically('/tmp/file.tmp', '/tmp/file.epub')).resolves.toBeUndefined();

    expect(mockRename).toHaveBeenCalledWith('/tmp/file.tmp', '/tmp/file.epub');
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('cleans temp path and rethrows rename error when rename fails', async () => {
    mockRename.mockRejectedValue(new Error('cross-device link'));
    mockUnlink.mockResolvedValue(undefined);

    await expect(replaceFileAtomically('/tmp/file.tmp', '/tmp/file.epub')).rejects.toThrow('cross-device link');
    expect(mockUnlink).toHaveBeenCalledWith('/tmp/file.tmp');
  });

  it('ignores ENOENT while cleaning temp path after rename failure', async () => {
    const renameError = new Error('permission denied');
    const cleanupError = Object.assign(new Error('not found'), { code: 'ENOENT' });

    mockRename.mockRejectedValue(renameError);
    mockUnlink.mockRejectedValue(cleanupError);

    await expect(replaceFileAtomically('/tmp/file.tmp', '/tmp/file.epub')).rejects.toThrow('permission denied');
  });

  it('throws aggregate error when rename and cleanup both fail', async () => {
    mockRename.mockRejectedValue(new Error('rename failed'));
    mockUnlink.mockRejectedValue(Object.assign(new Error('cleanup failed'), { code: 'EACCES' }));

    await expect(replaceFileAtomically('/tmp/file.tmp', '/tmp/file.epub')).rejects.toThrow('Failed to replace file atomically');
  });
});
