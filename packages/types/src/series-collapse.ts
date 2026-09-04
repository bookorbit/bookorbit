export type SeriesCollapsePreferences = {
  global: boolean;
  libraries: Record<string, boolean>;
  collections: Record<string, boolean>;
  smartScopes?: Record<string, boolean>;
  /**
   * Author pages share one flag instead of a per-author bucket: the bucket would grow with every
   * author browsed, and "collapsed for King but not for Pratchett" is not a distinction anyone
   * asks for. Absent means off, so an upgrade leaves author pages flat even for a user whose
   * {@link SeriesCollapsePreferences.global} is on.
   */
  authorPages?: boolean;
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
  ctx: { libraryId?: number; collectionId?: number; smartScopeId?: number; authorPages?: boolean },
): boolean {
  if (!prefs) return false;
  // Author pages resolve to their own flag and stop there — they deliberately do not inherit the
  // global default, and the library filter on an author page is a filter, not a scope to override.
  if (ctx.authorPages) return prefs.authorPages ?? false;
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
