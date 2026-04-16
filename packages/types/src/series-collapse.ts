export type SeriesCollapsePreferences = {
  global: boolean;
  libraries: Record<string, boolean>;
  collections: Record<string, boolean>;
};

export type CollapsedSeriesInfo = {
  bookCount: number;
  readCount: number;
  coverBookIds: number[];
  seriesLatestAddedAt: string | null;
};

export function resolveCollapsePreference(prefs: SeriesCollapsePreferences | undefined, ctx: { libraryId?: number; collectionId?: number }): boolean {
  if (!prefs) return false;
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
