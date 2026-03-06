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
    const normalizedAllowed = libraryAllowedFormats.map((f) => f.trim().toLowerCase()).filter(Boolean);

    if (!SUPPORTED_BOOK_FORMATS.has(ext)) {
      throw new BadRequestException(`Unsupported file type .${ext}. Allowed types: ${[...SUPPORTED_BOOK_FORMATS].join(', ')}`);
    }

    if (normalizedAllowed.length > 0 && !normalizedAllowed.includes(ext)) {
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
      .trim();

    if (!sanitized) return 'upload';

    // Dotfile-like names (e.g. ".epub") have no extname() stem.
    if (sanitized.startsWith('.') && !sanitized.slice(1).includes('.')) {
      return `upload${sanitized}`;
    }

    const ext = extname(sanitized);
    if (!ext) return sanitized.slice(0, 255);
    if (ext.length >= 255) return sanitized.slice(0, 255);

    const stem = sanitized.slice(0, -ext.length).slice(0, 255 - ext.length).trim();
    return `${stem || 'upload'}${ext}`;
  }
}
