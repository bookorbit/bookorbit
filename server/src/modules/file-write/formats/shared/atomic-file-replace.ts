import { rename, unlink } from 'fs/promises';

export async function replaceFileAtomically(tempPath: string, targetPath: string): Promise<void> {
  try {
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

function isErrnoCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === code;
}
