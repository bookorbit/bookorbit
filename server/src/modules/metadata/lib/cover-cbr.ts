import { readFile } from 'fs/promises';
import { createExtractorFromData } from 'node-unrar-js';
import { isArchiveImageFile, isHiddenArchivePath } from './archive-image-utils';

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export async function extractCbrCover(absolutePath: string): Promise<Buffer | null> {
  try {
    const buf = await readFile(absolutePath);
    const ab = toArrayBuffer(buf);

    // First pass: list files to find the first image, sorted naturally.
    const listExtractor = await createExtractorFromData({ data: ab });
    const { fileHeaders } = listExtractor.getFileList();
    const images = [...fileHeaders]
      .filter((h) => !h.flags.directory && isArchiveImageFile(h.name) && !isHiddenArchivePath(h.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    if (images.length === 0) return null;
    const firstName = images[0].name;

    // Second pass: extract only that file. Must drain the generator fully to avoid WASM leak.
    const extractExtractor = await createExtractorFromData({ data: ab });
    const { files } = extractExtractor.extract({ files: (h) => h.name === firstName });
    let result: Uint8Array | undefined;
    for (const file of files) {
      if (!file.fileHeader.flags.directory) result = file.extraction;
    }

    return result ? Buffer.from(result) : null;
  } catch {
    return null;
  }
}
