import type {
  HardcoverBookSyncEffectiveReason,
  HardcoverBookSyncMode,
  HardcoverBookSyncOverride,
  HardcoverSyncDisabledReason,
  ReadStatus,
} from '@bookorbit/types';

const SYNCABLE_STATUSES = new Set<ReadStatus>(['want_to_read', 'reading', 'rereading', 'on_hold', 'read', 'skimmed', 'abandoned']);

export interface HardcoverBookSyncPolicySettings {
  effectiveEnabled: boolean;
  disabledReason: HardcoverSyncDisabledReason | null;
  bookSyncMode: HardcoverBookSyncMode;
}

export interface HardcoverBookSyncDecision {
  syncEnabled: boolean;
  effectiveReason: HardcoverBookSyncEffectiveReason | null;
}

export function normalizeHardcoverBookSyncOverride(
  input: { syncOverride?: string | null; syncExcluded?: boolean | null } | null | undefined,
): HardcoverBookSyncOverride {
  if (input?.syncOverride === 'included' || input?.syncOverride === 'excluded') return input.syncOverride;
  if (input?.syncExcluded === true) return 'excluded';
  return null;
}

/** A book in an excluded library only syncs when included on its own, so turning it on has to say so. */
export function resolveHardcoverBookSyncOverrideForToggle(
  bookSyncMode: HardcoverBookSyncMode,
  syncEnabled: boolean,
  libraryExcluded = false,
): HardcoverBookSyncOverride {
  if (libraryExcluded || bookSyncMode === 'selected_only') {
    return syncEnabled ? 'included' : null;
  }
  return syncEnabled ? null : 'excluded';
}

export function resolveHardcoverBookSyncDecision(input: {
  settings: HardcoverBookSyncPolicySettings;
  status: string | null | undefined;
  syncOverride: HardcoverBookSyncOverride;
  libraryExcluded?: boolean;
}): HardcoverBookSyncDecision {
  if (!input.settings.effectiveEnabled) {
    return {
      syncEnabled: false,
      effectiveReason: input.settings.disabledReason ?? 'global_disabled',
    };
  }

  // Ahead of the status, so an unread book in an excluded library does not read as waiting to sync.
  if (input.libraryExcluded && input.syncOverride === null) {
    return { syncEnabled: false, effectiveReason: 'library_excluded' };
  }

  if (!input.status || !SYNCABLE_STATUSES.has(input.status as ReadStatus)) {
    return {
      syncEnabled: false,
      effectiveReason: input.status === 'unread' ? 'unread' : 'unsupported_status',
    };
  }

  if (input.syncOverride === 'excluded') {
    return { syncEnabled: false, effectiveReason: 'excluded' };
  }

  if (input.syncOverride === 'included') {
    return { syncEnabled: true, effectiveReason: null };
  }

  if (input.settings.bookSyncMode === 'all_eligible') {
    return { syncEnabled: true, effectiveReason: null };
  }

  return { syncEnabled: false, effectiveReason: 'not_selected' };
}
