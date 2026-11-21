import { canonicalSeriesIndex } from './book-duplicate-normalize';

export type DuplicateGroupingPair = {
  bookIdA: number;
  bookIdB: number;
  reasons: readonly string[];
  titleSimilarity: number | null;
};

export type DuplicateGroupingSeriesPosition = {
  bookId: number;
  seriesId: number;
  seriesIndex: string | null;
};

const REASON_STRENGTH: Record<string, number> = { file_hash: 4, isbn: 3, exact_metadata: 2, fuzzy_metadata: 1 };

function strength(pair: DuplicateGroupingPair): number {
  return Math.max(0, ...pair.reasons.map((reason) => REASON_STRENGTH[reason] ?? 0));
}

/**
 * Joins duplicate pairs into groups, strongest evidence first, and refuses a join that would put two
 * positions of one series in the same group: a copy with no series data must not bridge volume 1 and
 * volume 2 into one merge. A matching file hash always joins. Returns the root of every book in a group of
 * two or more, the group's lowest book id.
 */
export function groupDuplicatePairs(
  pairs: readonly DuplicateGroupingPair[],
  positions: readonly DuplicateGroupingSeriesPosition[],
): Map<number, number> {
  const parent = new Map<number, number>();
  const seriesByRoot = new Map<number, Map<number, Set<string>>>();

  for (const position of positions) {
    const index = canonicalSeriesIndex(position.seriesIndex);
    if (index === null) continue;
    let series = seriesByRoot.get(position.bookId);
    if (!series) seriesByRoot.set(position.bookId, (series = new Map()));
    let indexes = series.get(position.seriesId);
    if (!indexes) series.set(position.seriesId, (indexes = new Set()));
    indexes.add(index);
  }

  const find = (bookId: number): number => {
    let root = parent.get(bookId) ?? bookId;
    while (root !== (parent.get(root) ?? root)) root = parent.get(root)!;
    let node = bookId;
    while (node !== root) {
      const next = parent.get(node) ?? node;
      parent.set(node, root);
      node = next;
    }
    return root;
  };

  const conflicts = (rootA: number, rootB: number): boolean => {
    const seriesA = seriesByRoot.get(rootA);
    const seriesB = seriesByRoot.get(rootB);
    if (!seriesA || !seriesB) return false;
    for (const [seriesId, indexesA] of seriesA) {
      const indexesB = seriesB.get(seriesId);
      if (!indexesB) continue;
      if (indexesA.size > 1 || indexesB.size > 1) return true;
      if (!indexesB.has([...indexesA][0]!)) return true;
    }
    return false;
  };

  const ordered = [...pairs].sort(
    (x, y) => strength(y) - strength(x) || (y.titleSimilarity ?? 1) - (x.titleSimilarity ?? 1) || x.bookIdA - y.bookIdA || x.bookIdB - y.bookIdB,
  );

  for (const pair of ordered) {
    for (const bookId of [pair.bookIdA, pair.bookIdB]) if (!parent.has(bookId)) parent.set(bookId, bookId);
    const rootA = find(pair.bookIdA);
    const rootB = find(pair.bookIdB);
    if (rootA === rootB) continue;
    if (!pair.reasons.includes('file_hash') && conflicts(rootA, rootB)) continue;

    const root = Math.min(rootA, rootB);
    const absorbed = root === rootA ? rootB : rootA;
    parent.set(absorbed, root);
    const absorbedSeries = seriesByRoot.get(absorbed);
    if (absorbedSeries) {
      let rootSeries = seriesByRoot.get(root);
      if (!rootSeries) seriesByRoot.set(root, (rootSeries = new Map()));
      for (const [seriesId, indexes] of absorbedSeries) {
        const merged = rootSeries.get(seriesId);
        if (merged) for (const index of indexes) merged.add(index);
        else rootSeries.set(seriesId, new Set(indexes));
      }
      seriesByRoot.delete(absorbed);
    }
  }

  const roots = new Map<number, number>();
  const sizes = new Map<number, number>();
  for (const bookId of parent.keys()) {
    const root = find(bookId);
    roots.set(bookId, root);
    sizes.set(root, (sizes.get(root) ?? 0) + 1);
  }
  for (const [bookId, root] of roots) if (sizes.get(root)! < 2) roots.delete(bookId);
  return roots;
}
