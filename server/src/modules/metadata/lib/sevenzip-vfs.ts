import { getSevenZip } from '../../../common/sevenzip';

export type SevenZipInstance = Awaited<ReturnType<typeof getSevenZip>>;

/** Re-exported so the callers here keep one import; the helper itself is shared. */
export { createSevenZipTempId } from '../../../common/sevenzip';

export function cleanupSevenZipArtifacts(sevenZip: SevenZipInstance, archivePath: string, outDir: string): void {
  try {
    for (const fileName of sevenZip.FS.readdir(outDir).filter((f) => f !== '.' && f !== '..')) {
      sevenZip.FS.unlink(`${outDir}/${fileName}`);
    }
    sevenZip.FS.rmdir(outDir);
  } catch {
    // directory may not exist or may already be deleted
  }

  try {
    sevenZip.FS.unlink(archivePath);
  } catch {
    // archive may not exist or may already be deleted
  }
}
