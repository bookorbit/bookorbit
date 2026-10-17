import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  FONT_CSS_FAMILY_PREFIXES,
  MAX_SERVER_FONTS,
  fontCssFamilyGroupName,
  type FontUploadErrorCode,
  type ServerFontFamilyUsage,
  type ServerFontUsageResponse,
  type UserFont,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { ServerFontRow } from '../../db/schema';
import { toFontResponse } from '../font/dto/font-response.dto';
import type { UpdateFontDto } from '../font/dto/update-font.dto';
import { duplicateFont, faceTaken, familyFaceTaken, isUniqueViolation } from '../font/font-errors';
import { inspectFontUpload, resolveFontIdentity } from '../font/font-upload.pipeline';
import { FontValidationService } from '../font/font.validation.service';
import { ServerFontRepository } from './server-font.repository';
import { ServerFontStorageService } from './server-font.storage.service';

/** The user-preferences category holding each reader's hidden server families. */
const HIDDEN_FAMILIES_CATEGORY = 'server-fonts';

/**
 * Manages the administrator-curated font collection offered to every reader. Shares the
 * validation and metadata pipeline with per-user fonts but keeps its own table, storage
 * directory, and limits so neither scope can affect the other.
 */
@Injectable()
export class ServerFontService {
  private readonly logger = new Logger(ServerFontService.name);

  constructor(
    private readonly repo: ServerFontRepository,
    private readonly storage: ServerFontStorageService,
    private readonly validation: FontValidationService,
  ) {}

  async list() {
    const rows = await this.repo.findAll();
    return rows.map(toFontResponse);
  }

  async upload(user: RequestUser, buffer: Buffer, originalFilename: string) {
    const event = 'server_font.upload';
    const startedAt = Date.now();
    this.logger.log(
      `[${event}] [start] userId=${user.id} filename=${sanitizeLogValue(originalFilename)} sizeBytes=${buffer.length} - server font upload started`,
    );

    try {
      const { format, fileHash } = inspectFontUpload(this.validation, buffer, originalFilename);

      const existing = await this.repo.findByHash(fileHash);
      if (existing) throw duplicateFont(existing);

      const fontCount = await this.repo.countAll();
      if (fontCount >= MAX_SERVER_FONTS) {
        throw new BadRequestException({
          message: `Maximum of ${MAX_SERVER_FONTS} server fonts reached`,
          errorCode: 'FONT_LIMIT_REACHED' satisfies FontUploadErrorCode,
          errorMeta: { limit: MAX_SERVER_FONTS },
        });
      }

      const { familyName, weight, style, weightMin, weightMax, instances, suggestedFamilyName } = resolveFontIdentity(
        this.validation,
        buffer,
        originalFilename,
      );

      const storedFileName = await this.storage.save(format, buffer);

      let row: ServerFontRow;
      try {
        row = await this.repo.create({
          uploadedBy: user.id,
          familyName,
          originalFileName: originalFilename,
          storedFileName,
          format,
          weight,
          style,
          weightMin,
          weightMax,
          instances,
          fileSize: buffer.length,
          fileHash,
        });
      } catch (err) {
        await this.storage.delete(storedFileName);
        // A family/weight/style clash is a plausible admin mistake (the same face uploaded
        // under two filenames), so report it rather than letting it surface as a 500.
        if (isUniqueViolation(err)) {
          throw faceTaken(familyName, weight, style, `A server font already exists for "${familyName}" at weight ${weight} (${style})`);
        }
        throw err;
      }

      this.logger.log(
        `[${event}] [end] userId=${user.id} fontId=${row.id} durationMs=${Date.now() - startedAt} familyName=${sanitizeLogValue(familyName)} format=${format} - server font upload completed`,
      );

      return {
        font: toFontResponse(row),
        suggestedFamilyName,
        suggestedWeight: weight,
        suggestedStyle: style,
      };
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = (err instanceof Error ? err.message : String(err)).slice(0, 200);
      this.logger.warn(
        `[${event}] [fail] userId=${user.id} filename=${sanitizeLogValue(originalFilename)} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(errorMessage)}" - server font upload failed`,
      );
      throw err;
    }
  }

  async update(fontId: number, dto: UpdateFontDto) {
    const font = await this.findFont(fontId);

    const data: Partial<Pick<ServerFontRow, 'familyName' | 'weight' | 'style'>> = {};
    if (dto.familyName !== undefined) data.familyName = dto.familyName;
    if (dto.weight !== undefined) data.weight = dto.weight;
    if (dto.style !== undefined) data.style = dto.style;

    if (Object.keys(data).length === 0) {
      return toFontResponse(font);
    }

    let updated: ServerFontRow | undefined;
    try {
      updated = await this.repo.update(fontId, data);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw faceTaken(
          data.familyName ?? font.familyName,
          data.weight ?? font.weight,
          data.style ?? font.style,
          'Another server font already uses that family, weight, and style',
        );
      }
      throw err;
    }

    if (!updated) throw new NotFoundException('Font not found');
    return toFontResponse(updated);
  }

  async renameFamily(familyName: string, newFamilyName: string): Promise<UserFont[]> {
    const event = 'server_font.rename_family';
    const startedAt = Date.now();
    const next = newFamilyName.trim();
    const current = await this.repo.findByFamily(familyName);
    if (current.length === 0) throw new NotFoundException('Font family not found');
    if (!next) throw new BadRequestException('Family name cannot be empty');
    if (next === familyName) return current.map(toFontResponse);

    this.logger.log(
      `[${event}] [start] familyName=${sanitizeLogValue(familyName)} newFamilyName=${sanitizeLogValue(next)} files=${current.length} - server font family rename started`,
    );
    let rows: ServerFontRow[];
    try {
      rows = await this.repo.renameFamily(familyName, next);
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      this.logger.warn(
        `[${event}] [fail] familyName=${sanitizeLogValue(familyName)} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(err instanceof Error ? err.message.slice(0, 200) : String(err))}" - server font family rename failed`,
      );
      if (isUniqueViolation(err)) throw familyFaceTaken(next);
      throw err;
    }
    this.logger.log(
      `[${event}] [end] familyName=${sanitizeLogValue(next)} files=${rows.length} durationMs=${Date.now() - startedAt} - server font family rename completed`,
    );
    return rows.map(toFontResponse);
  }

  /**
   * Readers' saved settings name a family by its CSS group name, so counts are gathered per CSS
   * name and handed back to every family that produces it.
   */
  async usage(): Promise<ServerFontUsageResponse> {
    const [rows, books, defaults, hidden] = await Promise.all([
      this.repo.findAll(),
      this.repo.countBooksByCssFamily(FONT_CSS_FAMILY_PREFIXES.server),
      this.repo.countDefaultsByCssFamily(FONT_CSS_FAMILY_PREFIXES.server),
      this.repo.countHiddenByFamily(HIDDEN_FAMILIES_CATEGORY),
    ]);
    const booksByCss = new Map(books.map((b) => [b.cssFamily, b]));
    const defaultsByCss = new Map(defaults.map((d) => [d.cssFamily, d.readers]));
    const hiddenByName = new Map(hidden.map((h) => [h.familyName, h.readers]));

    const families: ServerFontFamilyUsage[] = [...new Set(rows.map((row) => row.familyName))].map((familyName) => {
      const css = fontCssFamilyGroupName(familyName, 'server');
      return {
        familyName,
        books: booksByCss.get(css)?.books ?? 0,
        readers: booksByCss.get(css)?.readers ?? 0,
        defaults: defaultsByCss.get(css) ?? 0,
        hidden: hiddenByName.get(familyName) ?? 0,
      };
    });
    return { families };
  }

  async remove(fontId: number): Promise<void> {
    const font = await this.findFont(fontId);
    await this.repo.delete(fontId);
    await this.storage.delete(font.storedFileName);
  }

  async getFileInfo(fontId: number) {
    const font = await this.findFont(fontId);
    const filePath = await this.storage.getPathIfExists(font.storedFileName);
    if (!filePath) {
      throw new NotFoundException('Font file not found on disk');
    }
    return { filePath, font };
  }

  private async findFont(fontId: number): Promise<ServerFontRow> {
    const font = await this.repo.findById(fontId);
    if (!font) {
      throw new NotFoundException('Font not found');
    }
    return font;
  }
}
