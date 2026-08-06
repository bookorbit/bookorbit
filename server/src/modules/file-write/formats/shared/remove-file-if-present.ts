import { unlink } from 'fs/promises';

/**
 * Deletes a file, ignoring the case where it never existed.
 *
 * Intended for cleaning up temp artifacts on a failure path, where the original
 * error is what matters and a cleanup failure must not mask it.
 */
export async function removeFileIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Cleanup is best-effort; preserve the primary write result or error.
  }
}
