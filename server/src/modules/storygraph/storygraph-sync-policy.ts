import type {
  ReadStatus,
  StorygraphBookSyncEffectiveReason,
  StorygraphBookSyncMode,
  StorygraphBookSyncOverride,
  StorygraphSyncDisabledReason,
} from '@bookorbit/types';

const SYNCABLE_STATUSES = new Set<ReadStatus>(['want_to_read', 'reading', 'rereading', 'on_hold', 'read', 'skimmed', 'abandoned']);

export interface StorygraphBookSyncPolicySettings {
  effectiveEnabled: boolean;
  disabledReason: StorygraphSyncDisabledReason | null;
  bookSyncMode: StorygraphBookSyncMode;
}

export interface StorygraphBookSyncDecision {
  syncEnabled: boolean;
  effectiveReason: StorygraphBookSyncEffectiveReason | null;
}

export function normalizeStorygraphBookSyncOverride(input: { syncOverride?: string | null } | string | null | undefined): StorygraphBookSyncOverride {
  const value = typeof input === 'string' || input === null ? input : input?.syncOverride;
  return value === 'included' || value === 'excluded' ? value : null;
}

/** A book in an excluded library only syncs when included on its own, so turning it on has to say so. */
export function resolveStorygraphBookSyncOverrideForToggle(
  bookSyncMode: StorygraphBookSyncMode,
  syncEnabled: boolean,
  libraryExcluded = false,
): StorygraphBookSyncOverride {
  if (libraryExcluded || bookSyncMode === 'selected_only') {
    return syncEnabled ? 'included' : null;
  }
  return syncEnabled ? null : 'excluded';
}

export function resolveStorygraphBookSyncDecision(input: {
  settings: StorygraphBookSyncPolicySettings;
  status: string | null | undefined;
  syncOverride: StorygraphBookSyncOverride;
  libraryExcluded?: boolean;
}): StorygraphBookSyncDecision {
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
