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

export function resolveStorygraphBookSyncOverrideForToggle(bookSyncMode: StorygraphBookSyncMode, syncEnabled: boolean): StorygraphBookSyncOverride {
  if (bookSyncMode === 'selected_only') {
    return syncEnabled ? 'included' : null;
  }
  return syncEnabled ? null : 'excluded';
}

export function resolveStorygraphBookSyncDecision(input: {
  settings: StorygraphBookSyncPolicySettings;
  status: string | null | undefined;
  syncOverride: StorygraphBookSyncOverride;
}): StorygraphBookSyncDecision {
  if (!input.settings.effectiveEnabled) {
    return {
      syncEnabled: false,
      effectiveReason: input.settings.disabledReason ?? 'global_disabled',
    };
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
