import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { basename, extname } from 'path';
import {
  CUSTOM_ICON_CATALOG_LIMIT,
  CUSTOM_ICON_MAX_FILE_SIZE,
  CUSTOM_ICON_MAX_UPLOAD_FILES,
  CUSTOM_ICON_NAME_MAX_LENGTH,
  CUSTOM_ICON_SLUG_MAX_LENGTH,
  slugifyIconName,
  type CustomIcon,
  type CustomIconCatalog,
  type CustomIconPage,
  type CustomIconSort,
  type CustomIconStageItem,
  type CustomIconStageResponse,
  type CustomIconUploadItem,
  type CustomIconUploadMetaItem,
  type CustomIconUploadResponse,
  type CustomIconUsage,
} from '@bookorbit/types';

import type { CustomIconRow } from '../../db/schema';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { CustomIconRepository } from './custom-icon.repository';
import { sanitizeSvgIcon } from './custom-icon.sanitizer';
import { CustomIconStorageService } from './custom-icon.storage.service';
import type { UpdateCustomIconDto } from './dto/update-custom-icon.dto';

const CUSTOM_ICON_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface UploadInput {
  filename: string;
  bytes: Buffer;
}

interface ListPageParams {
  q?: string;
  sort: CustomIconSort;
  page: number;
  size: number;
}

@Injectable()
export class CustomIconService {
  private readonly logger = new Logger(CustomIconService.name);

  constructor(
    private readonly repo: CustomIconRepository,
    private readonly storage: CustomIconStorageService,
  ) {}

  async catalog(): Promise<CustomIconCatalog> {
    const { items, total } = await this.repo.findCatalog(CUSTOM_ICON_CATALOG_LIMIT);
    return { items: items.map((row) => this.toResponse(row)), total };
  }

  async listPage(params: ListPageParams): Promise<CustomIconPage> {
    const { items, total } = await this.repo.findPage(params);
    return { items: items.map((row) => this.toResponse(row)), total, page: params.page, size: params.size };
  }

  async getUsage(slug: string): Promise<CustomIconUsage> {
    const icon = await this.findBySlugOrThrow(slug);
    const breakdown = await this.repo.usageBreakdown(icon.slug);
    return {
      total: breakdown.libraries + breakdown.collections + breakdown.smartScopes,
      libraries: breakdown.libraries,
      collections: breakdown.collections,
      smartScopes: breakdown.smartScopes,
    };
  }

  async stageMany(files: UploadInput[]): Promise<CustomIconStageResponse> {
    if (files.length === 0) throw new BadRequestException('No files provided');
    if (files.length > CUSTOM_ICON_MAX_UPLOAD_FILES) {
      throw new BadRequestException(`Cannot stage more than ${CUSTOM_ICON_MAX_UPLOAD_FILES} icons at once`);
    }

    const staged: { file: UploadInput; sanitized: string; fileHash: string }[] = [];
    const items: CustomIconStageItem[] = files.map((file) => {
      try {
        const { sanitized, fileHash } = this.validateAndSanitize(file.filename, file.bytes);
        staged.push({ file, sanitized, fileHash });
        const baseName = displayNameFromFilename(file.filename);
        return {
          filename: file.filename,
          ok: true,
          suggestedName: baseName.slice(0, CUSTOM_ICON_NAME_MAX_LENGTH),
          sanitizedSvg: sanitized,
          fileHash,
        };
      } catch (error) {
        return { filename: file.filename, ok: false, error: this.errorMessage(error) };
      }
    });

    const hashes = [...new Set(staged.map((entry) => entry.fileHash))];
    const existing = await this.repo.findByHashes(hashes);
    const byHash = new Map(existing.map((row) => [row.fileHash, row]));
    for (const item of items) {
      if (!item.ok || !item.fileHash) continue;
      const match = byHash.get(item.fileHash);
      if (match) {
        item.duplicateOfSlug = match.slug;
        item.duplicateOfName = match.name;
      }
    }

    return { items };
  }

  async uploadMany(files: UploadInput[], meta?: CustomIconUploadMetaItem[]): Promise<CustomIconUploadResponse> {
    if (files.length === 0) throw new BadRequestException('No files provided');
    if (files.length > CUSTOM_ICON_MAX_UPLOAD_FILES) {
      throw new BadRequestException(`Cannot upload more than ${CUSTOM_ICON_MAX_UPLOAD_FILES} icons at once`);
    }

    const items: CustomIconUploadItem[] = [];
    const reservedSlugs = new Set<string>();
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      try {
        const icon = await this.uploadOne(file, reservedSlugs, meta?.[i]);
        items.push({ filename: file.filename, status: 'created', icon });
      } catch (error) {
        items.push({ filename: file.filename, status: 'failed', error: this.errorMessage(error) });
      }
    }
    return { items };
  }

  async update(slug: string, dto: UpdateCustomIconDto): Promise<CustomIcon> {
    const existing = await this.findBySlugOrThrow(slug);
    if (dto.name === undefined) return this.toResponse(existing);

    const updated = await this.repo.update(existing.slug, {
      name: dto.name,
    });
    if (!updated) throw new NotFoundException('Custom icon not found');
    return this.toResponse(updated);
  }

  async replaceSvg(slug: string, filename: string, bytes: Buffer): Promise<CustomIcon> {
    const existing = await this.findBySlugOrThrow(slug);
    const { sanitized, fileHash } = this.validateAndSanitize(filename, bytes);
    const storedFileName = await this.storage.save(sanitized);
    let updated: CustomIconRow | undefined;
    try {
      updated = await this.repo.update(slug, {
        originalFileName: filename,
        storedFileName,
        fileSize: Buffer.byteLength(sanitized, 'utf8'),
        fileHash,
      });
    } catch (error) {
      await this.storage.delete(storedFileName);
      throw error;
    }
    if (!updated) {
      await this.storage.delete(storedFileName);
      throw new NotFoundException('Custom icon not found');
    }
    await this.storage.delete(existing.storedFileName);
    return this.toResponse(updated);
  }

  async remove(slug: string): Promise<void> {
    const deleted = await this.repo.delete(slug);
    if (!deleted) throw new NotFoundException('Custom icon not found');
    await this.storage.delete(deleted.storedFileName);
  }

  async bulkRemove(slugs: string[]): Promise<{ deleted: string[]; failed: string[] }> {
    const unique = [...new Set(slugs.map((slug) => slug.trim()).filter((slug) => CUSTOM_ICON_SLUG_REGEX.test(slug)))];
    if (unique.length === 0) throw new BadRequestException('No valid slugs provided');

    const startedAt = Date.now();
    const event = 'custom_icon.bulk_delete';
    this.logger.log(`[${event}] [start] count=${unique.length} - bulk delete started`);

    const deletedRows = await this.repo.deleteMany(unique);
    await Promise.all(deletedRows.map((row) => this.storage.delete(row.storedFileName)));
    const deleted = deletedRows.map((row) => row.slug);
    const deletedSet = new Set(deleted);
    const failed = unique.filter((slug) => !deletedSet.has(slug));

    this.logger.log(
      `[${event}] [end] count=${unique.length} durationMs=${Date.now() - startedAt} deleted=${deleted.length} failed=${failed.length} - bulk delete completed`,
    );
    return { deleted, failed };
  }

  async getFileInfo(slug: string): Promise<{ filePath: string; icon: CustomIconRow }> {
    const icon = await this.findBySlugOrThrow(slug);
    const filePath = await this.storage.getPathIfExists(icon.storedFileName);
    if (!filePath) throw new NotFoundException('Custom icon file not found on disk');
    return { filePath, icon };
  }

  private async uploadOne(file: UploadInput, reservedSlugs: Set<string>, meta?: CustomIconUploadMetaItem): Promise<CustomIcon> {
    const startedAt = Date.now();
    const event = 'custom_icon.upload';
    this.logger.log(`[${event}] [start] filename="${sanitizeLogValue(file.filename)}" sizeBytes=${file.bytes.length} - custom icon upload started`);

    try {
      const { sanitized, fileHash } = this.validateAndSanitize(file.filename, file.bytes);
      const name = this.resolveName(file.filename, meta);
      const slug = await this.resolveSlug(name, reservedSlugs);
      reservedSlugs.add(slug);
      const storedFileName = await this.storage.save(sanitized);

      let row: CustomIconRow;
      try {
        row = await this.repo.create({
          slug,
          name,
          originalFileName: file.filename,
          storedFileName,
          fileSize: Buffer.byteLength(sanitized, 'utf8'),
          fileHash,
        });
      } catch (error) {
        await this.storage.delete(storedFileName);
        throw error;
      }

      this.logger.log(`[${event}] [end] slug=${slug} durationMs=${Date.now() - startedAt} - custom icon upload completed`);
      return this.toResponse(row);
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      this.logger.warn(
        `[${event}] [fail] filename="${sanitizeLogValue(file.filename)}" durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(this.errorMessage(error))}" - custom icon upload failed`,
      );
      throw error;
    }
  }

  private resolveName(filename: string, meta?: CustomIconUploadMetaItem): string {
    const candidate = meta?.name?.trim();
    const name = candidate || displayNameFromFilename(filename);
    return name.slice(0, CUSTOM_ICON_NAME_MAX_LENGTH);
  }

  private async resolveSlug(name: string, reservedSlugs: Set<string>): Promise<string> {
    return this.nextAvailableSlug(slugifyIconName(name) || 'custom-icon', reservedSlugs);
  }

  private validateAndSanitize(filename: string, bytes: Buffer): { sanitized: string; fileHash: string } {
    if (bytes.length === 0) throw new BadRequestException('SVG file is empty');
    if (bytes.length > CUSTOM_ICON_MAX_FILE_SIZE) {
      throw new BadRequestException(`SVG file exceeds maximum size of ${CUSTOM_ICON_MAX_FILE_SIZE / 1024} KB`);
    }
    if (extname(filename).toLowerCase() !== '.svg') {
      throw new BadRequestException('Only SVG files are supported');
    }
    const sanitized = sanitizeSvgIcon(bytes);
    return { sanitized, fileHash: createHash('sha256').update(sanitized).digest('hex') };
  }

  private async nextAvailableSlug(baseSlug: string, reservedSlugs: Set<string>): Promise<string> {
    const base = this.normalizeSlug(baseSlug);

    // Fast path: the base slug is usually free on the first upload.
    if (!reservedSlugs.has(base)) {
      const existingBase = await this.repo.findExistingSlugs([base]);
      if (existingBase.length === 0) return base;
    }

    // Fallback: find the first available suffixed slug.
    const suffixCandidates = Array.from({ length: 998 }, (_, i) => slugWithSuffix(base, i + 2));
    const existing = new Set(await this.repo.findExistingSlugs(suffixCandidates));
    const available = suffixCandidates.find((c) => !existing.has(c) && !reservedSlugs.has(c));
    if (!available) throw new ConflictException('Could not create a unique slug for this icon');
    return available;
  }

  private normalizeSlug(value: string): string {
    const slug = slugifyIconName(value);
    if (!slug) throw new BadRequestException('Slug is required');
    return slug;
  }

  private async findBySlugOrThrow(slug: string): Promise<CustomIconRow> {
    const validSlug = validateSlugParam(slug);
    const icon = await this.repo.findBySlug(validSlug);
    if (!icon) throw new NotFoundException('Custom icon not found');
    return icon;
  }

  private toResponse(row: CustomIconRow): CustomIcon {
    return {
      slug: row.slug,
      name: row.name,
      svgUrl: `/api/v1/custom-icons/${row.slug}.svg?v=${row.fileHash}`,
      fileHash: row.fileHash,
      fileSize: row.fileSize,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

function displayNameFromFilename(filename: string): string {
  const name = basename(filename, extname(filename)).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return name || 'Custom Icon';
}

function slugWithSuffix(base: string, suffixNumber: number): string {
  const suffix = `-${suffixNumber}`;
  const baseLimit = CUSTOM_ICON_SLUG_MAX_LENGTH - suffix.length;
  return `${base.slice(0, baseLimit).replace(/-+$/g, '')}${suffix}`;
}

function validateSlugParam(value: string): string {
  const slug = value.trim();
  if (slug.length > CUSTOM_ICON_SLUG_MAX_LENGTH || !CUSTOM_ICON_SLUG_REGEX.test(slug)) {
    throw new BadRequestException('Invalid custom icon slug');
  }
  return slug;
}
