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
