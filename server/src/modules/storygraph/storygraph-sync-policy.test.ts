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
});
