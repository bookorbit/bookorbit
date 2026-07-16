export type SeriesCollapsePreferences = {
  global: boolean;
  libraries: Record<string, boolean>;
  collections: Record<string, boolean>;
  smartScopes?: Record<string, boolean>;
};

export type CollapsedSeriesInfo = {
  bookCount: number;
  readCount: number;
  coverBookIds: number[];
  coverUpdatedAtByBookId?: Record<number, string | null>;
  seriesLatestAddedAt: string | null;
  firstVolumeBookId?: number | null;
  latestVolumeBookId?: number | null;
  firstUnreadBookId?: number | null;
};

export function resolveCollapsePreference(
  prefs: SeriesCollapsePreferences | undefined,
  ctx: { libraryId?: number; collectionId?: number; smartScopeId?: number },
): boolean {
  if (!prefs) return false;
  if (ctx.smartScopeId !== undefined) {
    const override = prefs.smartScopes?.[String(ctx.smartScopeId)];
    if (override !== undefined) return override;
  }
  if (ctx.collectionId !== undefined) {
    const override = prefs.collections?.[String(ctx.collectionId)];
    if (override !== undefined) return override;
  }
  if (ctx.libraryId !== undefined) {
    const override = prefs.libraries?.[String(ctx.libraryId)];
    if (override !== undefined) return override;
  }
  return prefs.global ?? false;
}
