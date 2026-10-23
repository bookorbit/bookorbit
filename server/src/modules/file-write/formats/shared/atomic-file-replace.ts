import { chmod, chown, rename, stat, unlink } from 'fs/promises';

/**
 * Replaces `targetPath` with `tempPath` in one rename, so a reader never sees a half-written file.
 *
 * The temp file is a new inode, so it first takes on the original's mode and, where the server is
 * allowed to, its owner and group: otherwise a read-only or group-shared book came back with the
 * process defaults. A hardlinked original still splits from its twins, which is deliberate: the
 * twin is commonly a torrent's seeding copy, and changing it would corrupt the torrent.
 */
export async function replaceFileAtomically(tempPath: string, targetPath: string): Promise<void> {
  try {
    await carryOverAttributes(tempPath, targetPath);
    await rename(tempPath, targetPath);
  } catch (renameError) {
    try {
      await unlink(tempPath);
    } catch (cleanupError) {
      if (!isErrnoCode(cleanupError, 'ENOENT')) {
        const renameCause = toError(renameError);
        const cleanupCause = toError(cleanupError);
        throw new Error(
          `Failed to replace file atomically tempPath=${tempPath} targetPath=${targetPath} renameError="${renameCause.message}" cleanupError="${cleanupCause.message}"`,
          { cause: cleanupError },
        );
      }
    }
    throw renameError;
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function carryOverAttributes(tempPath: string, targetPath: string): Promise<void> {
  const original = await stat(targetPath).catch(() => null);
  if (!original) return;

  await chmod(tempPath, original.mode & 0o7777);
  const temp = await stat(tempPath);
  if (temp.uid === original.uid && temp.gid === original.gid) return;
  try {
    await chown(tempPath, original.uid, original.gid);
  } catch (error) {
    // Only a privileged process may give a file away; an unprivileged one keeps its own ownership.
    if (!isErrnoCode(error, 'EPERM') && !isErrnoCode(error, 'ENOTSUP') && !isErrnoCode(error, 'EINVAL')) throw error;
  }
}

function isErrnoCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === code;
}
