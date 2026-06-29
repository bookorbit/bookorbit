import { extractCbzZipEntry, isSupportedCbzZipCompression, readCbzZipIndex } from '../../../common/cbz-zip-reader';
import { compareArchiveEntryNames, isArchiveImageFile, isHiddenArchivePath } from './archive-image-utils';

/**
 * Extract the first naturally-sorted image from a CBZ file using the ZIP central directory.
 *
 * Reading sizes from the central directory (rather than local file headers) is
 * required because many CBZ files use data descriptors — a ZIP feature where the
 * compressed/uncompressed sizes in the local file header are left as zero and the
 * real values appear in a trailing descriptor after the data. The central directory
 * always carries the correct sizes regardless of this flag.
 *
 * Supports STORED (0) and DEFLATE (8) compression.
 */
export async function extractCbzCover(absolutePath: string): Promise<Buffer | null> {
  try {
    const index = await readCbzZipIndex(absolutePath);
    const images = index?.entries.filter(
      (entry) =>
        !entry.name.endsWith('/') && !isHiddenArchivePath(entry.name) && isArchiveImageFile(entry.name) && isSupportedCbzZipCompression(entry),
    );
    if (!images?.length) return null;

    images.sort((a, b) => compareArchiveEntryNames(a.name, b.name));
    for (const image of images) {
      try {
        const extracted = await extractCbzZipEntry(absolutePath, image);
        if (extracted) return extracted;
      } catch {
        continue;
      }
    }

    return null;
  } catch {
    return null;
  }
}
