import { describe, expect, it } from 'vitest';

import {
  normalizeStorygraphBookSyncOverride,
  resolveStorygraphBookSyncDecision,
  resolveStorygraphBookSyncOverrideForToggle,
  type StorygraphBookSyncPolicySettings,
} from './storygraph-sync-policy';

const baseSettings: StorygraphBookSyncPolicySettings = {
  effectiveEnabled: true,
  disabledReason: null,
  bookSyncMode: 'all_eligible',
};

describe('storygraph sync policy', () => {
  it('defaults all eligible mode to enabled for supported statuses', () => {
    expect(resolveStorygraphBookSyncDecision({ settings: baseSettings, status: 'reading', syncOverride: null })).toEqual({
      syncEnabled: true,
      effectiveReason: null,
    });
  });

  it('requires inclusion in selected-only mode', () => {
    expect(
      resolveStorygraphBookSyncDecision({
        settings: { ...baseSettings, bookSyncMode: 'selected_only' },
        status: 'reading',
        syncOverride: null,
      }),
    ).toEqual({
      syncEnabled: false,
      effectiveReason: 'not_selected',
    });
  });

  it('lets explicit inclusion override selected-only mode', () => {
    expect(
      resolveStorygraphBookSyncDecision({
        settings: { ...baseSettings, bookSyncMode: 'selected_only' },
        status: 'read',
        syncOverride: 'included',
      }),
    ).toEqual({
      syncEnabled: true,
      effectiveReason: null,
    });
  });

  it('maps toggle values to the right persisted overrides', () => {
    expect(resolveStorygraphBookSyncOverrideForToggle('all_eligible', true)).toBeNull();
    expect(resolveStorygraphBookSyncOverrideForToggle('all_eligible', false)).toBe('excluded');
    expect(resolveStorygraphBookSyncOverrideForToggle('selected_only', true)).toBe('included');
    expect(resolveStorygraphBookSyncOverrideForToggle('selected_only', false)).toBeNull();
  });

  it('normalizes unknown overrides to null', () => {
    expect(normalizeStorygraphBookSyncOverride({ syncOverride: 'included' })).toBe('included');
    expect(normalizeStorygraphBookSyncOverride({ syncOverride: 'legacy' })).toBeNull();
  });
  it('keeps books in an excluded library out of sync', () => {
    expect(
      resolveStorygraphBookSyncDecision({
        settings: baseSettings,
        status: 'reading',
        syncOverride: null,
        libraryExcluded: true,
      }),
    ).toEqual({ syncEnabled: false, effectiveReason: 'library_excluded' });
  });

  it('lets a book included on its own sync from an excluded library', () => {
    expect(
      resolveStorygraphBookSyncDecision({
        settings: baseSettings,
        status: 'reading',
        syncOverride: 'included',
        libraryExcluded: true,
      }),
    ).toEqual({ syncEnabled: true, effectiveReason: null });
  });

  it('reports an explicit exclusion before the library exclusion', () => {
    expect(
      resolveStorygraphBookSyncDecision({
        settings: baseSettings,
        status: 'reading',
        syncOverride: 'excluded',
        libraryExcluded: true,
      }),
    ).toEqual({ syncEnabled: false, effectiveReason: 'excluded' });
  });

  it('reports an unread book in an excluded library as excluded, not as waiting to sync', () => {
    expect(resolveStorygraphBookSyncDecision({ settings: baseSettings, status: 'unread', syncOverride: null, libraryExcluded: true })).toEqual({
      syncEnabled: false,
      effectiveReason: 'library_excluded',
    });
    expect(resolveStorygraphBookSyncDecision({ settings: baseSettings, status: 'unread', syncOverride: 'included', libraryExcluded: true })).toEqual({
      syncEnabled: false,
      effectiveReason: 'unread',
    });
  });

  it('includes a book on its own when turned on inside an excluded library', () => {
    expect(resolveStorygraphBookSyncOverrideForToggle('all_eligible', true, true)).toBe('included');
    expect(resolveStorygraphBookSyncOverrideForToggle('all_eligible', false, true)).toBeNull();
    expect(resolveStorygraphBookSyncOverrideForToggle('all_eligible', true, false)).toBeNull();
  });
});
