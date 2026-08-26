import { BadRequestException, Injectable } from '@nestjs/common';
import {
  BOOK_REQUEST_AUTOMATION_SETTING_KEYS,
  BOOK_REQUEST_DESTINATION_SETTING_KEYS,
  BOOK_REQUEST_IMPORT_FORMATS,
  BOOK_REQUEST_MEDIA_KINDS,
  BOOK_REQUEST_PROFILE_SETTING_KEYS,
  bookRequestDefaultFolderKey,
  bookRequestDefaultLibraryKey,
  bookRequestReleaseProfileKey,
  DEFAULT_BOOK_REQUEST_AUTOMATION_SETTINGS,
  emptyReleaseProfiles,
  emptyRequestDestinationDefaults,
  MAX_AUTO_GRAB_ATTEMPTS_LIMIT,
  MAX_AUTO_SEARCH_INTERVAL_HOURS,
  MAX_AUTO_SEARCH_MAX_AGE_DAYS,
  MAX_RELEASE_TIER_NAME_LENGTH,
  MAX_RELEASE_TIERS,
  MIN_AUTO_GRAB_SCORE_FLOOR,
  MIN_AUTO_SEARCH_INTERVAL_HOURS,
  MIN_AUTO_SEARCH_MAX_AGE_DAYS,
} from '@bookorbit/types';
import type {
  BookRequestAutomationSettings,
  BookRequestImportFormats,
  BookRequestMediaKind,
  ReleaseProfiles,
  ReleaseTier,
  RequestDestination,
  RequestDestinationDefaults,
  UpdateBookRequestAutomationSettingsPayload,
} from '@bookorbit/types';

import { AppSettingsService } from '../../app-settings/app-settings.service';
import { BookRequestRepository } from '../book-request.repository';

const KEYS = BOOK_REQUEST_AUTOMATION_SETTING_KEYS;

/**
 * The automation knobs, read from `app_settings` and validated on the way in.
 *
 * Every read falls back to the shipped default rather than throwing, so a hand-edited row cannot
 * stop the pipeline: a nonsense value reverts to the default and the operator sees the default in
 * the settings form, which is the state the instance is actually in.
 */
@Injectable()
export class RequestAutomationSettingsService {
  constructor(
    private readonly appSettings: AppSettingsService,
    private readonly repo: BookRequestRepository,
  ) {}

  async get(): Promise<BookRequestAutomationSettings> {
    const values = await this.appSettings.getValues([
      ...Object.values(KEYS),
      ...BOOK_REQUEST_DESTINATION_SETTING_KEYS,
      ...BOOK_REQUEST_PROFILE_SETTING_KEYS,
    ]);
    const defaults = DEFAULT_BOOK_REQUEST_AUTOMATION_SETTINGS;

    return {
      autoGrabEnabled: parseBoolean(values.get(KEYS.AUTO_GRAB_ENABLED), defaults.autoGrabEnabled),
      autoGrabMinScore: parseInteger(values.get(KEYS.AUTO_GRAB_MIN_SCORE), defaults.autoGrabMinScore, MIN_AUTO_GRAB_SCORE_FLOOR, 100),
      autoRetryEnabled: parseBoolean(values.get(KEYS.AUTO_RETRY_ENABLED), defaults.autoRetryEnabled),
      maxAutoGrabAttempts: parseInteger(values.get(KEYS.MAX_AUTO_GRAB_ATTEMPTS), defaults.maxAutoGrabAttempts, 1, MAX_AUTO_GRAB_ATTEMPTS_LIMIT),
      autoSearchEnabled: parseBoolean(values.get(KEYS.AUTO_SEARCH_ENABLED), defaults.autoSearchEnabled),
      autoSearchIntervalHours: parseInteger(
        values.get(KEYS.AUTO_SEARCH_INTERVAL_HOURS),
        defaults.autoSearchIntervalHours,
        MIN_AUTO_SEARCH_INTERVAL_HOURS,
        MAX_AUTO_SEARCH_INTERVAL_HOURS,
      ),
      autoSearchMaxAgeDays: parseInteger(
        values.get(KEYS.AUTO_SEARCH_MAX_AGE_DAYS),
        defaults.autoSearchMaxAgeDays,
        MIN_AUTO_SEARCH_MAX_AGE_DAYS,
        MAX_AUTO_SEARCH_MAX_AGE_DAYS,
      ),
      verificationEnabled: parseBoolean(values.get(KEYS.VERIFICATION_ENABLED), defaults.verificationEnabled),
      verificationThreshold: parseInteger(values.get(KEYS.VERIFICATION_THRESHOLD), defaults.verificationThreshold, 0, 100),
      importFormats: parseImportFormats(values.get(KEYS.IMPORT_FORMATS), defaults.importFormats),
      destinations: parseDestinations(values),
      profiles: parseProfiles(values),
    };
  }

  /**
   * The instance default for one medium, checked against the libraries that exist right now.
   *
   * A library or folder can be deleted long after it was set here, and nothing rewrites the
   * setting when that happens. So the stored ids are a hint rather than a destination: a library
   * that is gone resolves to nothing and the request falls back to needing a human, which is the
   * same place it would have been without a default at all.
   */
  async resolveDestinationFor(mediaKind: BookRequestMediaKind): Promise<RequestDestination> {
    const { destinations } = await this.get();
    const stored = destinations[mediaKind];
    if (stored.libraryId === null) return { libraryId: null, folderId: null };

    const folderId =
      stored.folderId !== null && (await this.repo.folderBelongsToLibrary(stored.folderId, stored.libraryId))
        ? stored.folderId
        : await this.repo.findFirstFolderId(stored.libraryId);

    // No folder means either the library is gone or it has none, and neither can hold a book.
    return folderId === null ? { libraryId: null, folderId: null } : { libraryId: stored.libraryId, folderId };
  }

  async update(payload: UpdateBookRequestAutomationSettingsPayload): Promise<BookRequestAutomationSettings> {
    const writes: Array<Promise<void>> = [];

    if (payload.autoGrabEnabled !== undefined) {
      writes.push(this.appSettings.setValue(KEYS.AUTO_GRAB_ENABLED, String(payload.autoGrabEnabled)));
    }
    if (payload.autoGrabMinScore !== undefined) {
      assertRange('The auto-grab score floor', payload.autoGrabMinScore, MIN_AUTO_GRAB_SCORE_FLOOR, 100);
      writes.push(this.appSettings.setValue(KEYS.AUTO_GRAB_MIN_SCORE, String(payload.autoGrabMinScore)));
    }
    if (payload.autoRetryEnabled !== undefined) {
      writes.push(this.appSettings.setValue(KEYS.AUTO_RETRY_ENABLED, String(payload.autoRetryEnabled)));
    }
    if (payload.maxAutoGrabAttempts !== undefined) {
      assertRange('The attempt limit', payload.maxAutoGrabAttempts, 1, MAX_AUTO_GRAB_ATTEMPTS_LIMIT);
      writes.push(this.appSettings.setValue(KEYS.MAX_AUTO_GRAB_ATTEMPTS, String(payload.maxAutoGrabAttempts)));
    }
    if (payload.autoSearchEnabled !== undefined) {
      writes.push(this.appSettings.setValue(KEYS.AUTO_SEARCH_ENABLED, String(payload.autoSearchEnabled)));
    }
    if (payload.autoSearchIntervalHours !== undefined) {
      assertRange('The re-search interval', payload.autoSearchIntervalHours, MIN_AUTO_SEARCH_INTERVAL_HOURS, MAX_AUTO_SEARCH_INTERVAL_HOURS);
      writes.push(this.appSettings.setValue(KEYS.AUTO_SEARCH_INTERVAL_HOURS, String(payload.autoSearchIntervalHours)));
    }
    if (payload.autoSearchMaxAgeDays !== undefined) {
      assertRange('The re-search cut-off', payload.autoSearchMaxAgeDays, MIN_AUTO_SEARCH_MAX_AGE_DAYS, MAX_AUTO_SEARCH_MAX_AGE_DAYS);
      writes.push(this.appSettings.setValue(KEYS.AUTO_SEARCH_MAX_AGE_DAYS, String(payload.autoSearchMaxAgeDays)));
    }
    if (payload.verificationEnabled !== undefined) {
      writes.push(this.appSettings.setValue(KEYS.VERIFICATION_ENABLED, String(payload.verificationEnabled)));
    }
    if (payload.verificationThreshold !== undefined) {
      assertRange('The verification threshold', payload.verificationThreshold, 0, 100);
      writes.push(this.appSettings.setValue(KEYS.VERIFICATION_THRESHOLD, String(payload.verificationThreshold)));
    }
    if (payload.importFormats !== undefined) {
      if (!BOOK_REQUEST_IMPORT_FORMATS.includes(payload.importFormats)) {
        throw new BadRequestException(`Import formats must be one of: ${BOOK_REQUEST_IMPORT_FORMATS.join(', ')}`);
      }
      writes.push(this.appSettings.setValue(KEYS.IMPORT_FORMATS, payload.importFormats));
    }
    if (payload.destinations !== undefined) {
      for (const mediaKind of BOOK_REQUEST_MEDIA_KINDS) {
        const destination = payload.destinations[mediaKind];
        if (destination === undefined) continue;
        const checked = await this.checkDestination(mediaKind, destination);
        writes.push(this.appSettings.setValue(bookRequestDefaultLibraryKey(mediaKind), checked.libraryId?.toString() ?? ''));
        writes.push(this.appSettings.setValue(bookRequestDefaultFolderKey(mediaKind), checked.folderId?.toString() ?? ''));
      }
    }

    if (payload.profiles !== undefined) {
      for (const mediaKind of BOOK_REQUEST_MEDIA_KINDS) {
        const tiers = payload.profiles[mediaKind];
        if (tiers === undefined) continue;
        writes.push(this.appSettings.setValue(bookRequestReleaseProfileKey(mediaKind), JSON.stringify(checkTiers(mediaKind, tiers))));
      }
    }

    await Promise.all(writes);
    return this.get();
  }

  /**
   * Refused at the form rather than stored and discovered later: a folder in another library would
   * carry every request of this medium into that other library at finalize time, and both ids are
   * individually valid so nothing downstream can tell the difference.
   */
  private async checkDestination(mediaKind: BookRequestMediaKind, destination: RequestDestination): Promise<RequestDestination> {
    if (destination.libraryId === null) return { libraryId: null, folderId: null };

    const folderId = destination.folderId ?? (await this.repo.findFirstFolderId(destination.libraryId));
    if (folderId === null) {
      throw new BadRequestException(`The default ${mediaKind} library has no folder to file books into`);
    }
    if (!(await this.repo.folderBelongsToLibrary(folderId, destination.libraryId))) {
      throw new BadRequestException(`The default ${mediaKind} folder is not part of the library chosen beside it`);
    }
    return { libraryId: destination.libraryId, folderId };
  }
}

/**
 * A stored id whose row has since been deleted parses fine, so this only settles the shape. What
 * still exists is decided at resolve time, against the libraries there are.
 */
function parseDestinations(values: Map<string, string>): RequestDestinationDefaults {
  const destinations = emptyRequestDestinationDefaults();
  for (const mediaKind of BOOK_REQUEST_MEDIA_KINDS) {
    const libraryId = parseId(values.get(bookRequestDefaultLibraryKey(mediaKind)));
    // A folder without a library is not a destination, so it is not carried on its own.
    destinations[mediaKind] =
      libraryId === null ? { libraryId: null, folderId: null } : { libraryId, folderId: parseId(values.get(bookRequestDefaultFolderKey(mediaKind))) };
  }
  return destinations;
}

/**
 * A stored profile that will not parse reverts to no profile rather than throwing. The tier axis
 * then disengages and the instance grabs on score alone, which is a working instance; refusing to
 * read the settings at all would take the whole automation down over one malformed row.
 */
function parseProfiles(values: Map<string, string>): ReleaseProfiles {
  const profiles = emptyReleaseProfiles();
  for (const mediaKind of BOOK_REQUEST_MEDIA_KINDS) {
    const raw = values.get(bookRequestReleaseProfileKey(mediaKind));
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) profiles[mediaKind] = checkTiers(mediaKind, parsed as ReleaseTier[]);
    } catch {
      // Left empty on purpose; see above.
    }
  }
  return profiles;
}

/**
 * Refused at the form rather than stored: a tier with no id cannot survive a reorder, and two
 * tiers sharing one id make "which tier matched" unanswerable on the release row.
 */
function checkTiers(mediaKind: BookRequestMediaKind, tiers: readonly ReleaseTier[]): ReleaseTier[] {
  if (!Array.isArray(tiers)) throw new BadRequestException(`The ${mediaKind} profile must be a list of tiers`);
  if (tiers.length > MAX_RELEASE_TIERS) {
    throw new BadRequestException(`A profile may hold at most ${MAX_RELEASE_TIERS} tiers`);
  }

  const seen = new Set<string>();
  return tiers.map((tier) => {
    const id = typeof tier?.id === 'string' ? tier.id.trim() : '';
    const name = typeof tier?.name === 'string' ? tier.name.trim() : '';
    if (!id) throw new BadRequestException('Every tier needs an id');
    if (seen.has(id)) throw new BadRequestException('Two tiers share the same id');
    seen.add(id);
    if (!name) throw new BadRequestException('Every tier needs a name');
    if (name.length > MAX_RELEASE_TIER_NAME_LENGTH) {
      throw new BadRequestException(`A tier name may be at most ${MAX_RELEASE_TIER_NAME_LENGTH} characters`);
    }
    return { id, name, conditions: tier.conditions ?? {} };
  });
}

function parseId(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function assertRange(label: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new BadRequestException(`${label} must be a whole number between ${min} and ${max}`);
  }
}

function parseImportFormats(raw: string | undefined, fallback: BookRequestImportFormats): BookRequestImportFormats {
  return BOOK_REQUEST_IMPORT_FORMATS.includes(raw as BookRequestImportFormats) ? (raw as BookRequestImportFormats) : fallback;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
}

function parseInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}
