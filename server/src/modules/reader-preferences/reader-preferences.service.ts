import { BadRequestException, Injectable } from '@nestjs/common';
import { READER_GROUP_DEFAULTS, getFormatGroup, type ReaderFormatGroup } from '@projectx/types';
import { z } from 'zod';

import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import { ReaderPreferencesRepository } from './reader-preferences.repository';

const VALID_FORMAT_GROUPS = Object.keys(READER_GROUP_DEFAULTS) as ReaderFormatGroup[];
const VALID_FORMAT_GROUPS_SET = new Set(VALID_FORMAT_GROUPS);

const EPUB_SETTINGS_SCHEMA = z
  .object({
    themeName: z.string().min(1),
    isDark: z.boolean(),
    fontFamily: z.string().min(1).nullable(),
    fontSize: z.number().min(10).max(32),
    lineHeight: z.number().min(0.8).max(3),
    maxColumnCount: z.number().int().min(1).max(10),
    gap: z.number().min(0).max(0.5),
    maxInlineSize: z.number().int().min(400).max(1600),
    maxBlockSize: z.number().int().min(600).max(2400),
    justify: z.boolean(),
    hyphenate: z.boolean(),
    flow: z.enum(['paginated', 'scrolled']),
    overrideBookFormatting: z.boolean(),
  })
  .strict();

const PDF_SETTINGS_SCHEMA = z
  .object({
    scrollMode: z.enum(['vertical', 'horizontal', 'wrapped', 'page']),
    spread: z.enum(['none', 'odd', 'even']),
    zoomMode: z.enum(['fit-width', 'fit-page', 'custom']),
    customScale: z.number().min(0.25).max(4),
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  })
  .strict();

const CBX_SETTINGS_SCHEMA = z
  .object({
    fitMode: z.enum(['fit-page', 'fit-width', 'fit-height', 'actual']),
    viewMode: z.enum(['single', 'two-page']),
    scrollMode: z.enum(['paginated', 'infinite', 'long-strip']),
    direction: z.enum(['ltr', 'rtl']),
    bgColor: z.enum(['black', 'gray', 'white']),
  })
  .strict();

const AUDIO_SETTINGS_SCHEMA = z
  .object({
    playbackSpeed: z.number().min(0.5).max(3),
    volume: z.number().min(0).max(1),
    skipBackSeconds: z.number().int().min(0),
    skipForwardSeconds: z.number().int().min(0),
  })
  .strict();

const FULL_SETTINGS_SCHEMA_BY_GROUP = {
  epub: EPUB_SETTINGS_SCHEMA,
  pdf: PDF_SETTINGS_SCHEMA,
  cbx: CBX_SETTINGS_SCHEMA,
  audio: AUDIO_SETTINGS_SCHEMA,
} satisfies Record<ReaderFormatGroup, z.ZodTypeAny>;

const PARTIAL_SETTINGS_SCHEMA_BY_GROUP = {
  epub: EPUB_SETTINGS_SCHEMA.partial(),
  pdf: PDF_SETTINGS_SCHEMA.partial(),
  cbx: CBX_SETTINGS_SCHEMA.partial(),
  audio: AUDIO_SETTINGS_SCHEMA.partial(),
} satisfies Record<ReaderFormatGroup, z.ZodTypeAny>;

function normalizeFormatGroup(formatGroup: string): ReaderFormatGroup {
  const normalized = formatGroup.trim().toLowerCase();
  if (!VALID_FORMAT_GROUPS_SET.has(normalized as ReaderFormatGroup)) {
    throw new BadRequestException(`Invalid format group "${formatGroup}". Must be one of: ${VALID_FORMAT_GROUPS.join(', ')}`);
  }
  return normalized as ReaderFormatGroup;
}

@Injectable()
export class ReaderPreferencesService {
  constructor(
    private readonly repo: ReaderPreferencesRepository,
    private readonly bookService: BookService,
  ) {}

  private validateSettings(formatGroup: ReaderFormatGroup, settings: Record<string, unknown>, allowPartial: boolean): Record<string, unknown> {
    const schema = allowPartial ? PARTIAL_SETTINGS_SCHEMA_BY_GROUP[formatGroup] : FULL_SETTINGS_SCHEMA_BY_GROUP[formatGroup];
    const result = schema.safeParse(settings);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const issuePath = firstIssue?.path.length ? firstIssue.path.join('.') : 'settings';
      const issueMessage = firstIssue?.message ?? 'Invalid settings payload';
      throw new BadRequestException(`Invalid ${formatGroup} reader settings at "${issuePath}": ${issueMessage}`);
    }
    return result.data as Record<string, unknown>;
  }

  async getPreference(user: RequestUser, bookFileId: number) {
    await this.bookService.verifyFileAccess(bookFileId, user);
    return this.repo.findPreference(user.id, bookFileId);
  }

  async upsertPreference(user: RequestUser, bookFileId: number, settings: Record<string, unknown>) {
    const file = await this.bookService.verifyFileAccess(bookFileId, user);
    const formatGroup = getFormatGroup(file.format ?? '');
    const validatedSettings = this.validateSettings(formatGroup, settings, true);
    await this.repo.upsertPreference(user.id, bookFileId, validatedSettings);
  }

  async deletePreference(user: RequestUser, bookFileId: number) {
    await this.bookService.verifyFileAccess(bookFileId, user);
    await this.repo.deletePreference(user.id, bookFileId);
  }

  async getAllDefaults(userId: number) {
    return this.repo.findAllDefaults(userId);
  }

  async upsertDefault(userId: number, formatGroup: string, settings: Record<string, unknown>) {
    const normalizedGroup = normalizeFormatGroup(formatGroup);
    const validatedSettings = this.validateSettings(normalizedGroup, settings, false);
    await this.repo.upsertDefault(userId, normalizedGroup, validatedSettings);
  }

  async deleteDefault(userId: number, formatGroup: string) {
    const normalizedGroup = normalizeFormatGroup(formatGroup);
    await this.repo.deleteDefault(userId, normalizedGroup);
  }
}
