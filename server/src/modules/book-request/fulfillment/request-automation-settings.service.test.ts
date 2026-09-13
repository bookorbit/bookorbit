import { BadRequestException } from '@nestjs/common';
import {
  BOOK_REQUEST_AUTOMATION_SETTING_KEYS,
  bookRequestDefaultFolderKey,
  bookRequestDefaultLibraryKey,
  bookRequestReleaseProfileKey,
  DEFAULT_BOOK_REQUEST_AUTOMATION_SETTINGS,
  emptyReleaseProfiles,
} from '@bookorbit/types';

import { RequestAutomationSettingsService } from './request-automation-settings.service';

const KEYS = BOOK_REQUEST_AUTOMATION_SETTING_KEYS;

function makeService(stored: Record<string, string> = {}, repoOverrides: Record<string, unknown> = {}) {
  const appSettings = {
    getValues: vi.fn().mockResolvedValue(new Map(Object.entries(stored))),
    setValue: vi.fn().mockResolvedValue(undefined),
  };
  const repo = {
    folderBelongsToLibrary: vi.fn().mockResolvedValue(true),
    findFirstFolderId: vi.fn().mockResolvedValue(9),
    ...repoOverrides,
  };
  return { service: new RequestAutomationSettingsService(appSettings as never, repo as never), appSettings, repo };
}

const NO_DESTINATIONS = {
  ebook: { libraryId: null, folderId: null },
  audiobook: { libraryId: null, folderId: null },
  comic: { libraryId: null, folderId: null },
};

describe('RequestAutomationSettingsService.get', () => {
  it('ships with unattended grabbing off', async () => {
    const { service } = makeService();
    await expect(service.get()).resolves.toEqual(DEFAULT_BOOK_REQUEST_AUTOMATION_SETTINGS);
  });

  it('reads every knob back in one round trip', async () => {
    const { service, appSettings } = makeService({
      [KEYS.AUTO_GRAB_ENABLED]: 'true',
      [KEYS.AUTO_GRAB_MIN_SCORE]: '90',
      [KEYS.AUTO_RETRY_ENABLED]: 'false',
      [KEYS.MAX_AUTO_GRAB_ATTEMPTS]: '2',
      [KEYS.VERIFICATION_ENABLED]: 'false',
      [KEYS.VERIFICATION_THRESHOLD]: '85',
      [KEYS.IMPORT_FORMATS]: 'preferred',
      [KEYS.AUTO_SEARCH_ENABLED]: 'true',
      [KEYS.AUTO_SEARCH_INTERVAL_HOURS]: '12',
      [KEYS.AUTO_SEARCH_MAX_AGE_DAYS]: '90',
    });

    await expect(service.get()).resolves.toEqual({
      autoGrabEnabled: true,
      autoGrabMinScore: 90,
      autoRetryEnabled: false,
      maxAutoGrabAttempts: 2,
      autoSearchEnabled: true,
      autoSearchIntervalHours: 12,
      autoSearchMaxAgeDays: 90,
      verificationEnabled: false,
      verificationThreshold: 85,
      importFormats: 'preferred',
      destinations: NO_DESTINATIONS,
      profiles: emptyReleaseProfiles(),
    });
    expect(appSettings.getValues).toHaveBeenCalledTimes(1);
  });

  /**
   * A hand-edited row must not be able to stop the pipeline, and it must not be able to smuggle a
   * floor past the bound the endpoint enforces: both revert to the shipped default.
   */
  it('falls back to the default for a value that is not a usable one', async () => {
    const { service } = makeService({
      [KEYS.AUTO_GRAB_MIN_SCORE]: 'quite high',
      [KEYS.MAX_AUTO_GRAB_ATTEMPTS]: '0',
      [KEYS.VERIFICATION_THRESHOLD]: '900',
      [KEYS.AUTO_GRAB_ENABLED]: 'yes',
    });

    await expect(service.get()).resolves.toEqual(DEFAULT_BOOK_REQUEST_AUTOMATION_SETTINGS);
  });

  it('reverts a score floor below the hard minimum rather than honouring it', async () => {
    const { service } = makeService({ [KEYS.AUTO_GRAB_MIN_SCORE]: '10' });
    await expect(service.get()).resolves.toMatchObject({ autoGrabMinScore: DEFAULT_BOOK_REQUEST_AUTOMATION_SETTINGS.autoGrabMinScore });
  });
});

describe('RequestAutomationSettingsService.update', () => {
  it('writes only the knobs the caller named', async () => {
    const { service, appSettings } = makeService();

    await service.update({ autoGrabEnabled: true });

    expect(appSettings.setValue).toHaveBeenCalledTimes(1);
    expect(appSettings.setValue).toHaveBeenCalledWith(KEYS.AUTO_GRAB_ENABLED, 'true');
  });

  it('refuses a score floor below the hard minimum', async () => {
    const { service, appSettings } = makeService();

    await expect(service.update({ autoGrabMinScore: 5 })).rejects.toBeInstanceOf(BadRequestException);
    expect(appSettings.setValue).not.toHaveBeenCalled();
  });

  it('refuses an unbounded number of attempts', async () => {
    const { service } = makeService();
    await expect(service.update({ maxAutoGrabAttempts: 0 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update({ maxAutoGrabAttempts: 99 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports the settings as they now stand', async () => {
    const { service, appSettings } = makeService();
    appSettings.getValues.mockResolvedValue(new Map([[KEYS.VERIFICATION_THRESHOLD, '60']]));

    await expect(service.update({ verificationThreshold: 60 })).resolves.toMatchObject({ verificationThreshold: 60 });
  });
});

describe('RequestAutomationSettingsService destinations', () => {
  it('reads a default destination per medium', async () => {
    const { service } = makeService({
      [bookRequestDefaultLibraryKey('ebook')]: '4',
      [bookRequestDefaultFolderKey('ebook')]: '9',
      [bookRequestDefaultLibraryKey('audiobook')]: '5',
      [bookRequestDefaultFolderKey('audiobook')]: '12',
    });

    const { destinations } = await service.get();

    expect(destinations.ebook).toEqual({ libraryId: 4, folderId: 9 });
    expect(destinations.audiobook).toEqual({ libraryId: 5, folderId: 12 });
    expect(destinations.comic).toEqual({ libraryId: null, folderId: null });
  });

  /** A folder on its own files into whichever library that folder belongs to, which nobody chose. */
  it('drops a stored folder whose library is unset', async () => {
    const { service } = makeService({ [bookRequestDefaultFolderKey('comic')]: '12' });

    await expect(service.get()).resolves.toMatchObject({ destinations: NO_DESTINATIONS });
  });

  it('writes one medium without touching the others', async () => {
    const { service, appSettings } = makeService();

    await service.update({ destinations: { audiobook: { libraryId: 5, folderId: 12 } } });

    expect(appSettings.setValue).toHaveBeenCalledWith(bookRequestDefaultLibraryKey('audiobook'), '5');
    expect(appSettings.setValue).toHaveBeenCalledWith(bookRequestDefaultFolderKey('audiobook'), '12');
    expect(appSettings.setValue).not.toHaveBeenCalledWith(bookRequestDefaultLibraryKey('ebook'), expect.anything());
  });

  it('fills in the library first folder when none was named', async () => {
    const { service, appSettings } = makeService();

    await service.update({ destinations: { ebook: { libraryId: 4, folderId: null } } });

    expect(appSettings.setValue).toHaveBeenCalledWith(bookRequestDefaultFolderKey('ebook'), '9');
  });

  it('refuses a folder that belongs to a different library', async () => {
    const { service, appSettings } = makeService({}, { folderBelongsToLibrary: vi.fn().mockResolvedValue(false) });

    await expect(service.update({ destinations: { ebook: { libraryId: 4, folderId: 99 } } })).rejects.toBeInstanceOf(BadRequestException);
    expect(appSettings.setValue).not.toHaveBeenCalled();
  });

  it('refuses a library with nowhere to file a book', async () => {
    const { service } = makeService({}, { findFirstFolderId: vi.fn().mockResolvedValue(null) });

    await expect(service.update({ destinations: { ebook: { libraryId: 4, folderId: null } } })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clears a medium when its library is set to null', async () => {
    const { service, appSettings } = makeService();

    await service.update({ destinations: { comic: { libraryId: null, folderId: null } } });

    expect(appSettings.setValue).toHaveBeenCalledWith(bookRequestDefaultLibraryKey('comic'), '');
    expect(appSettings.setValue).toHaveBeenCalledWith(bookRequestDefaultFolderKey('comic'), '');
  });
});

describe('RequestAutomationSettingsService.resolveDestinationFor', () => {
  it('resolves the stored destination for the medium asked about', async () => {
    const { service } = makeService({
      [bookRequestDefaultLibraryKey('audiobook')]: '5',
      [bookRequestDefaultFolderKey('audiobook')]: '12',
    });

    await expect(service.resolveDestinationFor('audiobook')).resolves.toEqual({ libraryId: 5, folderId: 12 });
  });

  it('resolves to nothing for a medium with no default', async () => {
    const { service } = makeService();

    await expect(service.resolveDestinationFor('ebook')).resolves.toEqual({ libraryId: null, folderId: null });
  });

  /**
   * The setting is not rewritten when a library is deleted, so a stored id outlives its row. It
   * has to resolve to nothing rather than to a destination that cannot take a file.
   */
  it('resolves to nothing when the stored library no longer exists', async () => {
    const { service } = makeService(
      { [bookRequestDefaultLibraryKey('ebook')]: '4', [bookRequestDefaultFolderKey('ebook')]: '9' },
      { folderBelongsToLibrary: vi.fn().mockResolvedValue(false), findFirstFolderId: vi.fn().mockResolvedValue(null) },
    );

    await expect(service.resolveDestinationFor('ebook')).resolves.toEqual({ libraryId: null, folderId: null });
  });

  it('falls back to the library first folder when the stored folder is gone', async () => {
    const { service } = makeService(
      { [bookRequestDefaultLibraryKey('ebook')]: '4', [bookRequestDefaultFolderKey('ebook')]: '99' },
      { folderBelongsToLibrary: vi.fn().mockResolvedValue(false), findFirstFolderId: vi.fn().mockResolvedValue(9) },
    );

    await expect(service.resolveDestinationFor('ebook')).resolves.toEqual({ libraryId: 4, folderId: 9 });
  });
  describe('release profiles', () => {
    const tier = (over = {}) => ({ id: 't1', name: 'M4B single file', conditions: { formats: ['m4b'], fileLayout: 'single' as const }, ...over });

    it('reads no profile as an empty list for every medium', async () => {
      const { service } = makeService();

      await expect(service.get()).resolves.toMatchObject({ profiles: emptyReleaseProfiles() });
    });

    it('round-trips a stored profile', async () => {
      const { service } = makeService({ [bookRequestReleaseProfileKey('audiobook')]: JSON.stringify([tier()]) });

      const { profiles } = await service.get();
      expect(profiles.audiobook).toEqual([tier()]);
      expect(profiles.ebook).toEqual([]);
    });

    it('writes one medium without touching the others', async () => {
      const { service, appSettings } = makeService();

      await service.update({ profiles: { audiobook: [tier()] } });

      expect(appSettings.setValue).toHaveBeenCalledWith(bookRequestReleaseProfileKey('audiobook'), JSON.stringify([tier()]));
      expect(appSettings.setValue).not.toHaveBeenCalledWith(bookRequestReleaseProfileKey('ebook'), expect.anything());
    });

    it('clears a profile with an empty list', async () => {
      const { service, appSettings } = makeService();

      await service.update({ profiles: { comic: [] } });

      expect(appSettings.setValue).toHaveBeenCalledWith(bookRequestReleaseProfileKey('comic'), '[]');
    });

    it('refuses a tier with no name, since the release row has nothing to show', async () => {
      const { service } = makeService();

      await expect(service.update({ profiles: { ebook: [tier({ name: '  ' })] } })).rejects.toBeInstanceOf(BadRequestException);
    });

    /** Two tiers sharing an id make "which tier matched" unanswerable, and a reorder ambiguous. */
    it('refuses two tiers that share an id', async () => {
      const { service } = makeService();

      await expect(service.update({ profiles: { ebook: [tier(), tier({ name: 'Other' })] } })).rejects.toBeInstanceOf(BadRequestException);
    });

    /**
     * A hand-edited row must not take the automation down: an unreadable profile reverts to none,
     * which grabs on score alone rather than refusing to read the settings at all.
     */
    it('reads an unparseable profile as no profile', async () => {
      const { service } = makeService({ [bookRequestReleaseProfileKey('ebook')]: 'not json' });

      await expect(service.get()).resolves.toMatchObject({ profiles: emptyReleaseProfiles() });
    });

    it('reads a profile that is not a list as no profile', async () => {
      const { service } = makeService({ [bookRequestReleaseProfileKey('ebook')]: '{"formats":["epub"]}' });

      await expect(service.get()).resolves.toMatchObject({ profiles: emptyReleaseProfiles() });
    });
  });
});
