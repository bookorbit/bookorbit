import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FONT_CSS_FAMILY_PREFIXES, MAX_FONTS_PER_USER, type FontUploadErrorCode, type UserFont, type UserFontUsageResponse } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { UserFontRow } from '../../db/schema';
import { FontRepository } from './font.repository';
import { FontStorageService } from './font.storage.service';
import { FontValidationService } from './font.validation.service';
import { duplicateFont, faceTaken, familyFaceTaken, isUniqueViolation } from './font-errors';
import { inspectFontUpload, resolveFontIdentity } from './font-upload.pipeline';
import { toFontResponse } from './dto/font-response.dto';
import type { UpdateFontDto } from './dto/update-font.dto';

@Injectable()
export class FontService {
  private readonly logger = new Logger(FontService.name);

  constructor(
    private readonly repo: FontRepository,
    private readonly storage: FontStorageService,
    private readonly validation: FontValidationService,
  ) {}

  async list(userId: number) {
    const rows = await this.repo.findAllByUser(userId);
    return rows.map(toFontResponse);
  }

  async upload(user: RequestUser, buffer: Buffer, originalFilename: string) {
    const event = 'font.upload';
    const startedAt = Date.now();
    this.logger.log(
      `[${event}] [start] userId=${user.id} filename=${sanitizeLogValue(originalFilename)} sizeBytes=${buffer.length} - font upload started`,
    );

    try {
      const { format, fileHash } = inspectFontUpload(this.validation, buffer, originalFilename);

      const existing = await this.repo.findByUserAndHash(user.id, fileHash);
      if (existing) throw duplicateFont(existing);

      const fontCount = await this.repo.countByUser(user.id);
      if (fontCount >= MAX_FONTS_PER_USER) {
        throw new BadRequestException({
          message: `Maximum of ${MAX_FONTS_PER_USER} fonts per user reached`,
          errorCode: 'FONT_LIMIT_REACHED' satisfies FontUploadErrorCode,
          errorMeta: { limit: MAX_FONTS_PER_USER },
        });
      }

      const { familyName, weight, style, weightMin, weightMax, instances, suggestedFamilyName } = resolveFontIdentity(
        this.validation,
        buffer,
        originalFilename,
      );

      const storedFileName = await this.storage.save(user.id, format, buffer);

      let row: UserFontRow;
      try {
        row = await this.repo.create({
          userId: user.id,
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
        await this.storage.delete(user.id, storedFileName);
        // The same face under a second filename is an easy mistake; say so instead of a 500.
        if (isUniqueViolation(err)) throw faceTaken(familyName, weight, style, `You already have "${familyName}" at weight ${weight} (${style})`);
        throw err;
      }

      this.logger.log(
        `[${event}] [end] userId=${user.id} fontId=${row.id} durationMs=${Date.now() - startedAt} familyName=${sanitizeLogValue(familyName)} format=${format} - font upload completed`,
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
        `[${event}] [fail] userId=${user.id} filename=${sanitizeLogValue(originalFilename)} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(errorMessage)}" - font upload failed`,
      );
      throw err;
    }
  }

  async update(user: RequestUser, fontId: number, dto: UpdateFontDto) {
    const font = await this.findOwnedFont(user, fontId);

    const data: Partial<Pick<UserFontRow, 'familyName' | 'weight' | 'style'>> = {};
    if (dto.familyName !== undefined) data.familyName = dto.familyName;
    if (dto.weight !== undefined) data.weight = dto.weight;
    if (dto.style !== undefined) data.style = dto.style;

    if (Object.keys(data).length === 0) {
      return toFontResponse(font);
    }

    let updated: UserFontRow | undefined;
    try {
      updated = await this.repo.update(fontId, data);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw faceTaken(
          data.familyName ?? font.familyName,
          data.weight ?? font.weight,
          data.style ?? font.style,
          'Another of your fonts already uses that family, weight, and style',
        );
      }
      throw err;
    }
    if (!updated) throw new NotFoundException('Font not found');
    return toFontResponse(updated);
  }

  async renameFamily(user: RequestUser, familyName: string, newFamilyName: string): Promise<UserFont[]> {
    const next = newFamilyName.trim();
    const current = await this.repo.findByUserAndFamily(user.id, familyName);
    if (current.length === 0) throw new NotFoundException('Font family not found');
    if (!next) throw new BadRequestException('Family name cannot be empty');
    if (next === familyName) return current.map(toFontResponse);

    try {
      const rows = await this.repo.renameFamily(user.id, familyName, next);
      return rows.map(toFontResponse);
    } catch (err) {
      if (isUniqueViolation(err)) throw familyFaceTaken(next);
      throw err;
    }
  }

  /** How this reader uses each custom font, their own and the server's, by the CSS name their settings store. */
  async usage(userId: number): Promise<UserFontUsageResponse> {
    const prefixes = [FONT_CSS_FAMILY_PREFIXES.user, FONT_CSS_FAMILY_PREFIXES.server];
    const [books, defaults] = await Promise.all([this.repo.countBooksByCssFamily(userId, prefixes), this.repo.findDefaultCssFamilies(userId)]);
    const defaultSet = new Set(defaults.filter((cssFamily) => prefixes.some((prefix) => cssFamily.startsWith(prefix))));
    const byCss = new Map(
      books.map((row) => [row.cssFamily, { cssFamily: row.cssFamily, books: row.books, isDefault: defaultSet.has(row.cssFamily) }]),
    );
    for (const cssFamily of defaultSet) if (!byCss.has(cssFamily)) byCss.set(cssFamily, { cssFamily, books: 0, isDefault: true });
    return { fonts: [...byCss.values()] };
  }

  async remove(user: RequestUser, fontId: number): Promise<void> {
    const font = await this.findOwnedFont(user, fontId);
    await this.repo.delete(fontId);
    await this.storage.delete(user.id, font.storedFileName);
  }

  async getFileInfo(user: RequestUser, fontId: number) {
    const font = await this.findOwnedFont(user, fontId);
    const filePath = await this.storage.getPathIfExists(user.id, font.storedFileName);
    if (!filePath) {
      throw new NotFoundException('Font file not found on disk');
    }
    return { filePath, font };
  }

  private async findOwnedFont(user: RequestUser, fontId: number): Promise<UserFontRow> {
    const font = await this.repo.findById(fontId);
    if (!font) {
      throw new NotFoundException('Font not found');
    }
    if (font.userId !== user.id) {
      throw new ForbiddenException('You do not own this font');
    }
    return font;
  }
}
