import { describe, expect, it } from 'vitest';

import type { BookDockSettings } from '@bookorbit/types';

import { resolveDockSettings, type LibraryDockSettingsSource } from './library-dock-settings';

const global: BookDockSettings = {
  bookDockPath: '/data/book-dock',
  autoFetchMetadata: true,
  autoFinalizeEnabled: true,
  autoFinalizeThreshold: 85,
  autoFinalizeLibraryId: null,
  autoFinalizeFolderId: null,
  autoFinalizeMetadataMode: 'safe_merge',
};

const inheritAll: LibraryDockSettingsSource = {
  autoFetchMetadata: null,
  autoFinalizeEnabled: null,
  autoFinalizeThreshold: null,
  autoFinalizeMetadataMode: null,
  autoJoin: false,
  keepOriginal: false,
};

describe('resolveDockSettings', () => {
  it('gives a dock with no overrides the global settings', () => {
    expect(resolveDockSettings(inheritAll, global)).toEqual({
      autoFetchMetadata: true,
      autoFinalizeEnabled: true,
      autoFinalizeThreshold: 85,
      autoFinalizeMetadataMode: 'safe_merge',
      autoJoin: false,
      keepOriginal: false,
    });
  });

  it.each([
    ['autoFetchMetadata', false],
    ['autoFinalizeEnabled', false],
    ['autoFinalizeThreshold', 95],
    ['autoFinalizeMetadataMode', 'fetched_only'],
  ] as const)('lets the dock override %s alone', (key, value) => {
    const effective = resolveDockSettings({ ...inheritAll, [key]: value }, global);
    expect(effective[key]).toBe(value);
    for (const other of ['autoFetchMetadata', 'autoFinalizeEnabled', 'autoFinalizeThreshold', 'autoFinalizeMetadataMode'] as const) {
      if (other !== key) expect(effective[other]).toBe(global[other]);
    }
  });

  it('keeps an override that matches the default as an override', () => {
    const effective = resolveDockSettings({ ...inheritAll, autoFinalizeEnabled: true }, { ...global, autoFinalizeEnabled: false });
    expect(effective.autoFinalizeEnabled).toBe(true);
  });

  it('follows a change to the global setting when the dock inherits', () => {
    expect(resolveDockSettings(inheritAll, { ...global, autoFinalizeThreshold: 70 }).autoFinalizeThreshold).toBe(70);
  });

  it('inherits the global mode when a stored mode is not one it knows', () => {
    const effective = resolveDockSettings(
      { ...inheritAll, autoFinalizeMetadataMode: 'something_new' },
      { ...global, autoFinalizeMetadataMode: 'embedded_only' },
    );
    expect(effective.autoFinalizeMetadataMode).toBe('embedded_only');
  });

  it('takes auto-join and keep-original from the dock, never from Unsorted', () => {
    const effective = resolveDockSettings(
      { ...inheritAll, autoJoin: true, keepOriginal: true },
      { ...global, unsortedAutoJoin: false, unsortedKeepOriginal: false },
    );
    expect(effective.autoJoin).toBe(true);
    expect(effective.keepOriginal).toBe(true);
  });

  it('gives Unsorted the global settings and its own two toggles', () => {
    expect(resolveDockSettings(null, { ...global, unsortedAutoJoin: true, unsortedKeepOriginal: true })).toEqual({
      autoFetchMetadata: true,
      autoFinalizeEnabled: true,
      autoFinalizeThreshold: 85,
      autoFinalizeMetadataMode: 'safe_merge',
      autoJoin: true,
      keepOriginal: true,
    });
  });

  it('treats Unsorted toggles missing from older settings as off', () => {
    const effective = resolveDockSettings(null, global);
    expect(effective.autoJoin).toBe(false);
    expect(effective.keepOriginal).toBe(false);
  });
});
