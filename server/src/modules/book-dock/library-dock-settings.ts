import type { BookDockEffectiveSettings, BookDockSettings } from '@bookorbit/types';

import type { LibraryDockRow } from '../../db/schema';

export type LibraryDockSettingsSource = Pick<
  LibraryDockRow,
  'autoFetchMetadata' | 'autoFinalizeEnabled' | 'autoFinalizeThreshold' | 'autoFinalizeMetadataMode' | 'autoJoin' | 'keepOriginal'
>;

/**
 * What a dock does once its overrides are laid over the global settings. A null override inherits.
 * `dock` null is Unsorted, which follows the global settings and carries its own two toggles there.
 */
export function resolveDockSettings(dock: LibraryDockSettingsSource | null, global: BookDockSettings): BookDockEffectiveSettings {
  if (!dock) {
    return {
      autoFetchMetadata: global.autoFetchMetadata,
      autoFinalizeEnabled: global.autoFinalizeEnabled,
      autoFinalizeThreshold: global.autoFinalizeThreshold,
      autoFinalizeMetadataMode: global.autoFinalizeMetadataMode,
      autoJoin: global.unsortedAutoJoin ?? false,
      keepOriginal: global.unsortedKeepOriginal ?? false,
    };
  }
  return {
    autoFetchMetadata: dock.autoFetchMetadata ?? global.autoFetchMetadata,
    autoFinalizeEnabled: dock.autoFinalizeEnabled ?? global.autoFinalizeEnabled,
    autoFinalizeThreshold: dock.autoFinalizeThreshold ?? global.autoFinalizeThreshold,
    autoFinalizeMetadataMode: isMetadataMode(dock.autoFinalizeMetadataMode) ? dock.autoFinalizeMetadataMode : global.autoFinalizeMetadataMode,
    autoJoin: dock.autoJoin,
    keepOriginal: dock.keepOriginal,
  };
}

export function isMetadataMode(value: string | null): value is BookDockEffectiveSettings['autoFinalizeMetadataMode'] {
  return value === 'safe_merge' || value === 'fetched_only' || value === 'embedded_only';
}
