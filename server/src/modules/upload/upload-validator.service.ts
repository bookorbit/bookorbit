import { BadRequestException, Injectable } from '@nestjs/common';
import { extname } from 'path';

export const SUPPORTED_BOOK_FORMATS = new Set(['epub', 'pdf', 'mobi', 'azw3', 'cbz', 'cbr', 'cb7', 'fb2']);

@Injectable()
export class UploadValidatorService {
  /**
   * Returns the normalized extension if valid; throws otherwise.
   * Checks against the global supported set and then any library-level format restriction.
   */
  validateFormat(filename: string, libraryAllowedFormats: string[]): string {
    const ext = extname(filename).toLowerCase().slice(1);

    if (!SUPPORTED_BOOK_FORMATS.has(ext)) {
      throw new BadRequestException(`Unsupported file type .${ext}. Allowed types: ${[...SUPPORTED_BOOK_FORMATS].join(', ')}`);
    }

    if (libraryAllowedFormats.length > 0 && !libraryAllowedFormats.includes(ext)) {
      throw new BadRequestException(`This library does not allow .${ext} files`);
    }

    return ext;
  }

  /**
   * Strips path separators, null bytes, and trims to 255 characters.
   * Preserves the original extension.
   */
  sanitizeFilename(raw: string): string {
    const sanitized = raw
      .replace(/[/\\:*?"<>|\0]/g, '_')
      .trim()
      .slice(0, 255);
    return sanitized || 'upload';
  }
}
