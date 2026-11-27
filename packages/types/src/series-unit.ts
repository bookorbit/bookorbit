import { compareSeriesIndices, type SeriesIndex } from "./series-index";

/**
 * What a book is within its series: a collected volume, a single chapter, or a single issue.
 * Null means unclassified, which sorts, counts and filters with volumes, so a series with nothing
 * marked behaves exactly as it did before units existed.
 */
export const SERIES_UNITS = ["volume", "chapter", "issue"] as const;
export type SeriesUnit = (typeof SERIES_UNITS)[number];

/**
 * The two groups every consumer works with. Chapters and issues behave the same; only their label
 * differs. Unclassified books belong to `volume`.
 */
export const SERIES_UNIT_CLASSES = ["volume", "chapter"] as const;
export type SeriesUnitClass = (typeof SERIES_UNIT_CLASSES)[number];

/** Books per unit in one series. Unclassified books are counted in `volume`. */
export type SeriesUnitCounts = {
  volume: number;
  chapter: number;
  issue: number;
};

export function parseSeriesUnit(value: unknown): SeriesUnit | null {
  return typeof value === "string" && (SERIES_UNITS as readonly string[]).includes(value) ? (value as SeriesUnit) : null;
}

export function seriesUnitClass(unit: SeriesUnit | string | null | undefined): SeriesUnitClass {
  return unit === "chapter" || unit === "issue" ? "chapter" : "volume";
}

const MARKERS: ReadonlyArray<readonly [SeriesUnit, readonly string[]]> = [
  ["volume", ["v", "vol", "volume", "t", "tome", "tomo", "band", "巻", "卷", "권", "冊", "册"]],
  ["chapter", ["c", "ch", "chap", "chapter", "chapitre", "cap", "capitulo", "capítulo", "第", "話", "话", "화", "회", "章"]],
  ["issue", ["#", "issue", "no", "nr", "n°", "nº"]],
];

/**
 * File-name markers and the unit each names, keyed by `seriesUnitMarkerKey`. `book`, `part` and
 * their translations name nothing: they are too common in prose titles.
 */
export const SERIES_UNIT_MARKERS: ReadonlyMap<string, SeriesUnit> = new Map(
  MARKERS.flatMap(([unit, markers]) => markers.map((marker) => [marker, unit] as const)),
);

/** The lookup key of a marker as a rule captured it: `Ch. ` and `ch` are the same marker. */
export function seriesUnitMarkerKey(marker: string): string {
  return marker
    .trim()
    .toLowerCase()
    .replace(/[.\s_-]+$/u, "");
}

/** The unit a file-name marker names, such as `v` in `v03`, `Ch.` in `Ch. 12` or `#` in `#7`. */
export function classifySeriesUnitMarker(marker: string | null | undefined): SeriesUnit | null {
  if (!marker) return null;
  return SERIES_UNIT_MARKERS.get(seriesUnitMarkerKey(marker)) ?? null;
}

/**
 * The volume a chapter or issue belongs to, which its numbers restart in: issue numbers begin again
 * in each run of a comic. Volumes and unclassified books never sit in a run.
 */
export function seriesRunOf(unit: SeriesUnit | string | null | undefined, volumeIndex: SeriesIndex | null | undefined): SeriesIndex | null {
  return seriesUnitClass(unit) === "chapter" ? (volumeIndex ?? null) : null;
}

export type SeriesPosition = {
  seriesIndex: SeriesIndex | null;
  unit?: SeriesUnit | string | null;
  volumeIndex?: SeriesIndex | null;
};

/** Run order: by volume number, with chapters and issues that name no volume after every run. */
export function compareSeriesRuns(a: SeriesIndex | null, b: SeriesIndex | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareSeriesIndices(a, b);
}

/**
 * Series order, mirroring the server's: volumes and unclassified books, then chapters and issues run
 * by run, each by number, with unnumbered books last. Returns 0 for the same position.
 */
export function compareSeriesPositions(a: SeriesPosition, b: SeriesPosition): number {
  const byClass = (seriesUnitClass(a.unit) === "chapter" ? 1 : 0) - (seriesUnitClass(b.unit) === "chapter" ? 1 : 0);
  if (byClass !== 0) return byClass;
  const byRun = compareSeriesRuns(seriesRunOf(a.unit, a.volumeIndex), seriesRunOf(b.unit, b.volumeIndex));
  if (byRun !== 0) return byRun;
  if (a.seriesIndex === b.seriesIndex) return 0;
  if (a.seriesIndex === null) return 1;
  if (b.seriesIndex === null) return -1;
  return compareSeriesIndices(a.seriesIndex, b.seriesIndex);
}
