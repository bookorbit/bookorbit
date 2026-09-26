import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CBX_SPREAD_GAP_MAX,
  CBX_SPREAD_GAP_MIN,
  CSS_FONT_WEIGHT_MAX,
  CSS_FONT_WEIGHT_MIN,
  EPUB_FONT_SIZE_MAX,
  EPUB_FONT_SIZE_MIN,
  EPUB_LETTER_SPACING_MAX,
  EPUB_LETTER_SPACING_MIN,
  EPUB_PARAGRAPH_SPACING_MAX,
  EPUB_PARAGRAPH_SPACING_MIN,
  EPUB_TEXT_INDENT_MAX,
  EPUB_TEXT_INDENT_MIN,
  EPUB_WORD_SPACING_MAX,
  EPUB_WORD_SPACING_MIN,
  READER_GROUP_DEFAULTS,
  getFormatGroup,
  type ReaderFormatGroup,
} from '@bookorbit/types';
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
    fontWeight: z.number().int().min(CSS_FONT_WEIGHT_MIN).max(CSS_FONT_WEIGHT_MAX),
    fontStyle: z.enum(['normal', 'italic']),
    fontSize: z.number().min(EPUB_FONT_SIZE_MIN).max(EPUB_FONT_SIZE_MAX),
    lineHeight: z.number().min(0.8).max(3),
    paragraphSpacing: z.number().min(EPUB_PARAGRAPH_SPACING_MIN).max(EPUB_PARAGRAPH_SPACING_MAX),
    letterSpacing: z.number().min(EPUB_LETTER_SPACING_MIN).max(EPUB_LETTER_SPACING_MAX).nullable(),
    wordSpacing: z.number().min(EPUB_WORD_SPACING_MIN).max(EPUB_WORD_SPACING_MAX).nullable(),
    textIndent: z.number().min(EPUB_TEXT_INDENT_MIN).max(EPUB_TEXT_INDENT_MAX).nullable(),
    maxColumnCount: z.number().int().min(1).max(10),
    gap: z.number().min(0).max(0.5),
    maxInlineSize: z.number().int().min(400).max(1600),
    maxBlockSize: z.number().int().min(600).max(2400),
    justify: z.boolean(),
    hyphenate: z.boolean(),
    flow: z.enum(['paginated', 'scrolled']),
    overrideBookFormatting: z.boolean(),
    footerDisplayMode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    fixedLayoutSpread: z.enum(['auto', 'none']),
  })
  .strict();

const PDF_SETTINGS_SCHEMA = z
  .object({
    scrollMode: z.enum(['vertical', 'horizontal', 'wrapped', 'page']).transform((mode) => (mode === 'wrapped' ? 'vertical' : mode)),
    spread: z.enum(['none', 'odd', 'even', 'auto']),
    zoomMode: z.enum(['fit-width', 'fit-page', 'automatic', 'custom']),
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
    spreadAlignment: z.enum(['normal', 'shifted']),
    spreadGap: z.number().int().min(CBX_SPREAD_GAP_MIN).max(CBX_SPREAD_GAP_MAX).default(CBX_SPREAD_GAP_MIN),
    forceTwoPage: z.boolean(),
    widePageSingletonMode: z.enum(['auto', 'disable']),
    bgColor: z.enum(['black', 'gray', 'white']),
    // Optional, not defaulted: a default here is injected into per-book deltas too, which would
    // pin every book the reader touches to the default and override the user's cbx default.
    autoAdvance: z.boolean().optional(),
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

const SETTINGS_KEYS_BY_GROUP = {
  epub: new Set(Object.keys(EPUB_SETTINGS_SCHEMA.shape)),
  pdf: new Set(Object.keys(PDF_SETTINGS_SCHEMA.shape)),
  cbx: new Set(Object.keys(CBX_SETTINGS_SCHEMA.shape)),
  audio: new Set(Object.keys(AUDIO_SETTINGS_SCHEMA.shape)),
} satisfies Record<ReaderFormatGroup, Set<string>>;

/**
 * Zod applies `.default()` while parsing a partial, so a cbx patch that never mentioned
 * `spreadGap` comes back carrying one. Writing that would pin the key on the book. Keep only the
 * keys the caller actually sent, while keeping the parsed value for each so schema transforms
 * (the pdf `wrapped` -> `vertical` rewrite) survive.
 */
function keepProvidedKeys(input: Record<string, unknown>, parsed: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const key of Object.keys(parsed)) {
    if (Object.hasOwn(input, key)) {
      kept[key] = parsed[key];
    }
  }
  return kept;
}

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

  /** Validates a sparse settings object and narrows it back to the keys the caller sent. */
  private validatePartialSettings(formatGroup: ReaderFormatGroup, settings: Record<string, unknown>): Record<string, unknown> {
    return keepProvidedKeys(settings, this.validateSettings(formatGroup, settings, true));
  }

  private validateUnsetKeys(formatGroup: ReaderFormatGroup, keys: string[]): string[] {
    const known = SETTINGS_KEYS_BY_GROUP[formatGroup];
    const unknown = keys.filter((key) => !known.has(key));
    if (unknown.length > 0) {
      throw new BadRequestException(`Invalid ${formatGroup} reader settings key in "unset": ${unknown.join(', ')}`);
    }
    return [...new Set(keys)];
  }

  async getPreference(user: RequestUser, bookFileId: number) {
    await this.bookService.verifyFileAccess(bookFileId, user);
    return this.repo.findPreference(user.id, bookFileId);
  }

  async upsertPreference(user: RequestUser, bookFileId: number, settings: Record<string, unknown>) {
    const file = await this.bookService.verifyFileAccess(bookFileId, user);
    const formatGroup = getFormatGroup(file.format ?? '');
    const validatedSettings = this.validatePartialSettings(formatGroup, settings);
    await this.repo.upsertPreference(user.id, bookFileId, validatedSettings);
  }

  async patchPreference(user: RequestUser, bookFileId: number, set?: Record<string, unknown>, unset?: string[]) {
    const file = await this.bookService.verifyFileAccess(bookFileId, user);
    const formatGroup = getFormatGroup(file.format ?? '');

    const hasSet = !!set && Object.keys(set).length > 0;
    const hasUnset = !!unset && unset.length > 0;
    if (!hasSet && !hasUnset) {
      throw new BadRequestException('Reader preference patch must carry at least one key in "set" or "unset"');
    }

    const validatedSet = hasSet ? this.validatePartialSettings(formatGroup, set) : {};
    const validatedUnset = hasUnset ? this.validateUnsetKeys(formatGroup, unset) : [];

    const conflicting = validatedUnset.filter((key) => Object.hasOwn(validatedSet, key));
    if (conflicting.length > 0) {
      throw new BadRequestException(`Reader preference patch sets and unsets the same key: ${conflicting.join(', ')}`);
    }

    await this.repo.patchPreference(user.id, bookFileId, validatedSet, validatedUnset);
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

  async patchDefault(userId: number, formatGroup: string, set?: Record<string, unknown>) {
    const normalizedGroup = normalizeFormatGroup(formatGroup);
    if (!set || Object.keys(set).length === 0) {
      throw new BadRequestException('Reader defaults patch must carry at least one key in "set"');
    }
    const validatedSet = this.validatePartialSettings(normalizedGroup, set);
    await this.repo.patchDefault(userId, normalizedGroup, { ...READER_GROUP_DEFAULTS[normalizedGroup] } as Record<string, unknown>, validatedSet);
  }

  async deleteDefault(userId: number, formatGroup: string) {
    const normalizedGroup = normalizeFormatGroup(formatGroup);
    await this.repo.deleteDefault(userId, normalizedGroup);
  }
}
