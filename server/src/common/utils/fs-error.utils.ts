/**
 * A missing path, either because the entry itself is gone or because a parent
 * component is not a directory. Callers translate this into a 404; every other
 * failure (EACCES, EIO, a stale network mount) must propagate rather than be
 * reported to the client as an absent file.
 */
export function isMissingFilesystemEntry(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
