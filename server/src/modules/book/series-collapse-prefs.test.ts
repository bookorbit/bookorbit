import { describe, it, expect } from 'vitest';
import { resolveCollapsePreference } from '@bookorbit/types';
import type { SeriesCollapsePreferences } from '@bookorbit/types';

describe('resolveCollapsePreference', () => {
  it('returns false when prefs is undefined', () => {
    expect(resolveCollapsePreference(undefined, {})).toBe(false);
    expect(resolveCollapsePreference(undefined, { libraryId: 1 })).toBe(false);
    expect(resolveCollapsePreference(undefined, { collectionId: 5 })).toBe(false);
    expect(resolveCollapsePreference(undefined, { smartScopeId: 8 })).toBe(false);
  });

  it('returns global value when no context is provided', () => {
    const prefs: SeriesCollapsePreferences = { global: true, libraries: {}, collections: {} };
    expect(resolveCollapsePreference(prefs, {})).toBe(true);

    const prefsOff: SeriesCollapsePreferences = { global: false, libraries: {}, collections: {} };
    expect(resolveCollapsePreference(prefsOff, {})).toBe(false);
  });

  it('falls back to global when no library override exists', () => {
    const prefs: SeriesCollapsePreferences = { global: true, libraries: { '2': false }, collections: {} };
    expect(resolveCollapsePreference(prefs, { libraryId: 99 })).toBe(true);
  });

  it('returns library override when present', () => {
    const prefs: SeriesCollapsePreferences = { global: true, libraries: { '3': false }, collections: {} };
    expect(resolveCollapsePreference(prefs, { libraryId: 3 })).toBe(false);
  });

  it('falls back to global when no collection override exists', () => {
    const prefs: SeriesCollapsePreferences = { global: false, libraries: {}, collections: { '10': true } };
    expect(resolveCollapsePreference(prefs, { collectionId: 99 })).toBe(false);
  });

  it('returns collection override when present', () => {
    const prefs: SeriesCollapsePreferences = { global: false, libraries: {}, collections: { '7': true } };
    expect(resolveCollapsePreference(prefs, { collectionId: 7 })).toBe(true);
  });

  it('returns smart scope override when present', () => {
    const prefs: SeriesCollapsePreferences = { global: false, libraries: {}, collections: {}, smartScopes: { '8': true } };
    expect(resolveCollapsePreference(prefs, { smartScopeId: 8 })).toBe(true);
    expect(resolveCollapsePreference(prefs, { smartScopeId: 9 })).toBe(false);
  });

  it('prefers collection override over library override', () => {
    const prefs: SeriesCollapsePreferences = {
      global: false,
      libraries: { '1': true },
      collections: { '5': false },
    };
    expect(resolveCollapsePreference(prefs, { collectionId: 5, libraryId: 1 })).toBe(false);
  });

  it('falls back to library override when collection override is absent', () => {
    const prefs: SeriesCollapsePreferences = {
      global: false,
      libraries: { '1': true },
      collections: {},
    };
    expect(resolveCollapsePreference(prefs, { collectionId: 99, libraryId: 1 })).toBe(true);
  });

  it('resolves with string keys matching numeric IDs', () => {
    const prefs: SeriesCollapsePreferences = { global: false, libraries: { '42': true }, collections: {} };
    expect(resolveCollapsePreference(prefs, { libraryId: 42 })).toBe(true);
  });

  describe('author pages', () => {
    it('returns the author pages flag when it is set', () => {
      const prefs: SeriesCollapsePreferences = { global: false, libraries: {}, collections: {}, authorPages: true };
      expect(resolveCollapsePreference(prefs, { authorPages: true })).toBe(true);
    });

    it('stays off for prefs saved before the flag existed, whatever global says', () => {
      const prefs: SeriesCollapsePreferences = { global: true, libraries: {}, collections: {} };
      expect(resolveCollapsePreference(prefs, { authorPages: true })).toBe(false);
    });

    it('does not inherit global, in either direction', () => {
      const globalOn: SeriesCollapsePreferences = { global: true, libraries: {}, collections: {}, authorPages: false };
      expect(resolveCollapsePreference(globalOn, { authorPages: true })).toBe(false);

      const globalOff: SeriesCollapsePreferences = { global: false, libraries: {}, collections: {}, authorPages: true };
      expect(resolveCollapsePreference(globalOff, { authorPages: true })).toBe(true);
    });

    it('ignores library overrides, since the author page filter is not a scope', () => {
      const prefs: SeriesCollapsePreferences = { global: false, libraries: { '3': true }, collections: {}, authorPages: false };
      expect(resolveCollapsePreference(prefs, { authorPages: true, libraryId: 3 })).toBe(false);
    });

    it('leaves the other scopes untouched when the flag is on', () => {
      const prefs: SeriesCollapsePreferences = { global: false, libraries: { '3': true }, collections: {}, authorPages: true };
      expect(resolveCollapsePreference(prefs, { libraryId: 3 })).toBe(true);
      expect(resolveCollapsePreference(prefs, {})).toBe(false);
    });
  });
});
