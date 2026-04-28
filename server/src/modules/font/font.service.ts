import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { MAX_FONT_FILE_SIZE, MAX_FONTS_PER_USER, FONT_FORMATS, type FontFormat } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { UserFontRow } from '../../db/schema';
import { FontRepository } from './font.repository';
import { FontStorageService } from './font.storage.service';
import { FontValidationService, familyNameFromFilename } from './font.validation.service';
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
    this.logger.log(`[${event}] [start] userId=${user.id} filename=${originalFilename} sizeBytes=${buffer.length} - font upload started`);

    try {
      if (buffer.length > MAX_FONT_FILE_SIZE) {
        throw new BadRequestException(`Font file exceeds maximum size of ${MAX_FONT_FILE_SIZE / 1024 / 1024} MB`);
      }

      const format = this.resolveFormat(originalFilename);
      this.validation.validateFormat(buffer, format);

      const fileHash = createHash('sha256').update(buffer).digest('hex');

      const existing = await this.repo.findByUserAndHash(user.id, fileHash);
      if (existing) {
        throw new ConflictException('This font file has already been uploaded');
      }

      const fontCount = await this.repo.countByUser(user.id);
      if (fontCount >= MAX_FONTS_PER_USER) {
        throw new BadRequestException(`Maximum of ${MAX_FONTS_PER_USER} fonts per user reached`);
      }

      const metadata = this.validation.extractMetadata(buffer, originalFilename);
      const familyName = metadata.familyName ?? familyNameFromFilename(originalFilename) ?? 'Custom Font';

      const storedFileName = await this.storage.save(user.id, format, buffer);

      let row: UserFontRow;
      try {
        row = await this.repo.create({
          userId: user.id,
          familyName,
          originalFileName: originalFilename,
          storedFileName,
          format,
          weight: metadata.weight,
          style: metadata.style,
          fileSize: buffer.length,
          fileHash,
        });
      } catch (err) {
        await this.storage.delete(user.id, storedFileName);
        throw err;
      }

      this.logger.log(
        `[${event}] [end] userId=${user.id} fontId=${row.id} durationMs=${Date.now() - startedAt} familyName=${familyName} format=${format} - font upload completed`,
      );

      return {
        font: toFontResponse(row),
        suggestedFamilyName: metadata.familyName,
        suggestedWeight: metadata.weight,
        suggestedStyle: metadata.style,
      };
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = (err instanceof Error ? err.message : String(err)).slice(0, 200);
      this.logger.warn(
        `[${event}] [fail] userId=${user.id} filename=${originalFilename} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - font upload failed`,
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

    const updated = await this.repo.update(fontId, data);
    if (!updated) throw new NotFoundException('Font not found');
    return toFontResponse(updated);
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

  private resolveFormat(filename: string): FontFormat {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext && (FONT_FORMATS as readonly string[]).includes(ext)) {
      return ext as FontFormat;
    }
    throw new BadRequestException(`Unsupported file extension. Supported formats: ${FONT_FORMATS.join(', ')}`);
  }
}
