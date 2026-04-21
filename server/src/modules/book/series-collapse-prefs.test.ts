import { describe, it, expect } from 'vitest';
import { resolveCollapsePreference } from '@bookorbit/types';
import type { SeriesCollapsePreferences } from '@bookorbit/types';

describe('resolveCollapsePreference', () => {
  it('returns false when prefs is undefined', () => {
    expect(resolveCollapsePreference(undefined, {})).toBe(false);
    expect(resolveCollapsePreference(undefined, { libraryId: 1 })).toBe(false);
    expect(resolveCollapsePreference(undefined, { collectionId: 5 })).toBe(false);
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
});
