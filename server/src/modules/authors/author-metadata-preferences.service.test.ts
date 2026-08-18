import { AuthorMetadataProviderKey } from '@bookorbit/types';

import { APP_SETTING_KEYS } from '../../common/constants/app-settings.constants';
import { AuthorMetadataPreferencesService } from './author-metadata-preferences.service';
import { AuthorMetadataPreferenceResolver } from './metadata/author-metadata-preference-resolver';

// getPreferences() reads settings in a fixed order: the preferences blob
// first, then (only when it is absent) the standalone write mode and the
// legacy config blob. drizzle's eq() output is circular and cannot be
// inspected from a stub, so sequence the responses instead.
function dbFor(rows: { preferences?: string; writeMode?: string; config?: string }) {
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoNothing, onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });

  const sequence = [rows.preferences, rows.writeMode, rows.config];
  let call = 0;
  const findFirst = vi.fn().mockImplementation(() => {
    const value = sequence[call++];
    return Promise.resolve(value === undefined ? undefined : { value });
  });

  return { db: { query: { appSettings: { findFirst } }, insert } as never, insert, values, onConflictDoNothing, onConflictDoUpdate };
}

describe('AuthorMetadataPreferencesService', () => {
  const resolver = new AuthorMetadataPreferenceResolver();

  afterEach(() => vi.restoreAllMocks());

  it('returns stored preferences through the resolver', async () => {
    const stored = JSON.stringify({
      fields: { description: { enabled: false, providers: [AuthorMetadataProviderKey.AUDNEXUS], mergeStrategy: 'overwrite' } },
    });
    const { db } = dbFor({ preferences: stored });
    const service = new AuthorMetadataPreferencesService(db, resolver);

    const prefs = await service.getPreferences();

    expect(prefs.fields.description).toEqual({
      enabled: false,
      providers: [AuthorMetadataProviderKey.AUDNEXUS],
      mergeStrategy: 'overwrite',
    });
    // Fields absent from the stored blob still come back populated.
    expect(prefs.fields.genres.providers).toEqual([AuthorMetadataProviderKey.GOODREADS]);
  });

  it('falls back to defaults when the stored value is unparseable', async () => {
    const { db } = dbFor({ preferences: '{not json' });
    const service = new AuthorMetadataPreferencesService(db, resolver);

    const prefs = await service.getPreferences();

    expect(prefs.fields.description.mergeStrategy).toBe('fillMissing');
  });

  it('seeds fillMissing from a legacy missing_only install', async () => {
    const { db, values, onConflictDoNothing } = dbFor({ writeMode: 'missing_only' });
    const service = new AuthorMetadataPreferencesService(db, resolver);

    const prefs = await service.getPreferences();

    expect(prefs.fields.description.mergeStrategy).toBe('fillMissing');
    expect(onConflictDoNothing).toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ key: APP_SETTING_KEYS.AUTHORS_METADATA_PREFERENCES }));
  });

  it('seeds overwriteIfProvided from a legacy always_refetch install', async () => {
    const { db } = dbFor({ writeMode: 'always_refetch' });
    const service = new AuthorMetadataPreferencesService(db, resolver);

    const prefs = await service.getPreferences();

    expect(prefs.fields.description.mergeStrategy).toBe('overwriteIfProvided');
    expect(prefs.fields.photo.mergeStrategy).toBe('overwriteIfProvided');
  });

  it('reads the legacy write mode out of the config blob when the standalone key is absent', async () => {
    const { db } = dbFor({ config: JSON.stringify({ enabled: true, writeMode: 'always_refetch' }) });
    const service = new AuthorMetadataPreferencesService(db, resolver);

    const prefs = await service.getPreferences();

    expect(prefs.fields.description.mergeStrategy).toBe('overwriteIfProvided');
  });

  it('does not overwrite preferences that already exist while seeding', async () => {
    const { db, onConflictDoNothing, onConflictDoUpdate } = dbFor({});
    const service = new AuthorMetadataPreferencesService(db, resolver);

    await service.getPreferences();

    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(onConflictDoUpdate).not.toHaveBeenCalled();
  });

  it('normalizes on write and upserts', async () => {
    const { db, onConflictDoUpdate } = dbFor({});
    const service = new AuthorMetadataPreferencesService(db, resolver);

    const saved = await service.setPreferences({
      fields: { description: { enabled: true, providers: ['goodreads', 'bogus'], mergeStrategy: 'overwrite' } },
    } as never);

    expect(saved.fields.description.providers).toEqual([AuthorMetadataProviderKey.GOODREADS]);
    expect(onConflictDoUpdate).toHaveBeenCalled();
  });
});
