export const REGEX_METADATA_LIMITS = {
  rules: 20,
  patternLength: 2048,
  pathLength: 4096,
} as const;

export const REGEX_METADATA_GROUPS = ["title", "author", "authors", "series", "seriesIndex", "publishedYear", "publishedDate"] as const;

export interface RegexMetadataRule {
  pattern: string;
  flags: string;
}

export const REGEX_METADATA_PRESETS = ["folder_series"] as const;
export type RegexMetadataPreset = (typeof REGEX_METADATA_PRESETS)[number];

export interface RegexMetadataConfig {
  rules: RegexMetadataRule[];
  /**
   * Set when the rules are a built-in preset. The server then runs the preset's current rules, so a
   * library saved with an earlier version of the preset picks up later fixes.
   */
  preset?: RegexMetadataPreset;
}

export interface RegexMetadataFields {
  title?: string;
  authors?: string[];
  seriesName?: string;
  seriesIndex?: string;
  publishedYear?: number;
  publishedDate?: string;
}

export type RegexMetadataDiagnosticCode =
  "invalid_pattern" | "missing_group" | "conflicting_authors" | "invalid_value" | "timeout" | "busy" | "worker_failed";

export interface RegexMetadataDiagnostic {
  code: RegexMetadataDiagnosticCode;
  ruleIndex?: number;
  field?: string;
}

export interface RegexMetadataPreview {
  inputPath: string;
  matched: boolean;
  ruleIndex: number | null;
  groups: Record<string, string>;
  metadata: RegexMetadataFields;
  diagnostics: RegexMetadataDiagnostic[];
}

export interface RegexMetadataValidation {
  valid: boolean;
  diagnostics: RegexMetadataDiagnostic[];
}

export type RegexMetadataReapplyFailureCode = "rules_unavailable" | "rules_invalid" | "file_unavailable" | "metadata_failed";

/** Progress of applying a library's saved path rules to the books already in it. */
export interface RegexMetadataReapplyJob {
  id: string;
  libraryId: number;
  status: "running" | "completed" | "failed";
  total: number;
  processed: number;
  updated: number;
  unchanged: number;
  /** Books no rule matched, or whose files were being written at the time. */
  skipped: number;
  failed: number;
  failureSamples: { bookId: number; code: RegexMetadataReapplyFailureCode }[];
}

/**
 * Folders that only group one series' files. Taking one as the series would merge every "Volume 1"
 * folder in the library into one series. Files in a specials folder join the series unnumbered, as
 * in Kavita, so "Annual 01" does not take issue 1's place.
 */
const VOLUME_FOLDER = String.raw`(?:\d+[\s._-]+)?(?:vol(?:ume)?|tome|tomo|band|livre|libro|part|pt|arc|season|saison|v)\.?[\s_-]*\d+[^/]*|(?:19|20)\d{2}`;
const SPECIALS_FOLDER = String.raw`specials?|extras?|annuals?|bonus|one[\s_-]?shots?|_oneshots`;
const GROUPING_FOLDER = `${VOLUME_FOLDER}|${SPECIALS_FOLDER}`;

/** A release tag such as "[Digital]", "[Group]" or "{Kodansha}"; parentheses are left alone, they carry run years. */
const RELEASE_TAG = String.raw`[\[{][^\]}/]*[\]}]`;

/**
 * The series is the nearest folder above the file, without its release tags, skipping one grouping
 * folder or a "Series/Series Vol. 3/" volume folder. The lazy lead makes the shallower folder win
 * when both fit. The series can neither start nor end with a tag, so a name splits only one way;
 * without that, a folder of many tags backtracks for seconds.
 */
const SERIES_FOLDER = String.raw`^(?:.*?/)??(?!(?:${GROUPING_FOLDER})/)(?:${RELEASE_TAG}\s*)*(?<series>[^/\[{\s][^/]*?)(?<![\]}\s])(?:\s*${RELEASE_TAG})*/`;
const FOLDER_SERIES = String.raw`${SERIES_FOLDER}(?:(?:${VOLUME_FOLDER}|\k<series>[\s._-]*(?:vol(?:ume)?|tome|v)\.?[\s_-]*\d+[^/]*)/)?`;
const SPECIALS_IN_SERIES = String.raw`${SERIES_FOLDER}(?:${SPECIALS_FOLDER})/[^/]+$`;

/** "Supergirl/Volume 05 (2005)/Supergirl (2005) ...": the file names the run the folder above does not. */
const RUN_YEAR_FILE_SERIES = String.raw`^(?:.*?/)??(?<runParent>[^/]+)/(?:vol(?:ume)?|tome)\.?[\s_-]*\d+[^/]*/(?<series>\k<runParent>\s*\((?:19|20)\d{2}\))`;

// Also skips markers inside brackets, where "(v2)" is a release version and "(c2004)" a copyright year.
const BEFORE_MARKER = String.raw`(?<![\p{L}\p{N}(\[])`;
const NUMBER = String.raw`0*(?<seriesIndex>\d+(?:[.,]\d+)?)(?![\p{L}\p{N}])`;
const CHAPTER_OR_ISSUE = String.raw`[^/]*?(?:${BEFORE_MARKER}(?:c|ch|chap|chapter|chapitre|cap|capitulo|issue|no|nr|n°)\.?[\s_-]*(?!(?:19|20)\d{2}(?!\d))|#\s*|第\s*)${NUMBER}[^/]*$`;
const VOLUME_THEN_ISSUE = String.raw`[^/]*?${BEFORE_MARKER}(?:v|vol|volume)\.?[\s_-]*\d+[\s_]+(?:#\s*)?${NUMBER}[^/]*$`;
const VOLUME = String.raw`[^/]*?${BEFORE_MARKER}(?:t|tome|tomo|v|vol|volume|band|book|livre|libro)\.?[\s_-]*${NUMBER}[^/]*$`;
const CJK_CHAPTER = String.raw`[^/]*?(?<!\p{N})0*(?<seriesIndex>\d+(?:\.\d+)?)\s*(?:話|话|화|회|章)[^/]*$`;
const CJK_VOLUME = String.raw`[^/]*?(?<!\p{N})0*(?<seriesIndex>\d+(?:\.\d+)?)\s*(?:巻|卷|권|冊|册)[^/]*$`;
// Needs punctuation after the number, so "100 Bullets 050" is not read as number 100.
const LEADING_NUMBER = String.raw`0*(?<seriesIndex>(?!(?:19|20)\d{2}(?!\d))\d{1,4}(?:\.\d+)?)(?:\s*[-\u2013_.)\]]\s*(?!\d)[^/]*)?$`;
const TRAILING_NUMBER = String.raw`[^/]*?[\s_]0*(?<seriesIndex>(?!(?:19|20)\d{2}(?!\d))\d{1,4}(?:\.\d+)?)(?![\p{L}\p{N}])(?:\s*[\[(][^\]()/]*[\])])*(?:\s+-\s[^/]*)?\s*$`;
const ANY_FILE = String.raw`[^/]+$`;

/**
 * Rules for the layout Komga and Kavita use, one folder per series and one file per volume,
 * chapter or issue. Files at the library root match none of them and keep their own metadata.
 */
export const FOLDER_SERIES_REGEX_METADATA: RegexMetadataConfig = {
  preset: "folder_series",
  rules: [
    RUN_YEAR_FILE_SERIES + CHAPTER_OR_ISSUE,
    RUN_YEAR_FILE_SERIES + TRAILING_NUMBER,
    SPECIALS_IN_SERIES,
    FOLDER_SERIES + CHAPTER_OR_ISSUE,
    FOLDER_SERIES + VOLUME_THEN_ISSUE,
    FOLDER_SERIES + VOLUME,
    FOLDER_SERIES + CJK_CHAPTER,
    FOLDER_SERIES + CJK_VOLUME,
    FOLDER_SERIES + LEADING_NUMBER,
    FOLDER_SERIES + TRAILING_NUMBER,
    FOLDER_SERIES + ANY_FILE,
  ].map((pattern) => ({ pattern, flags: "iu" })),
};

export function isFolderSeriesRegexMetadata(config: RegexMetadataConfig | null | undefined): boolean {
  const preset = FOLDER_SERIES_REGEX_METADATA.rules;
  return (
    !!config &&
    (config.preset === "folder_series" ||
      (config.rules.length === preset.length &&
        config.rules.every((rule, index) => rule.pattern === preset[index]!.pattern && rule.flags === preset[index]!.flags)))
  );
}

/** The rules to run for a saved config: a preset's current rules, or the config's own. */
export function resolveRegexMetadataConfig(config: RegexMetadataConfig | null | undefined): RegexMetadataConfig | null {
  if (!config) return null;
  if (isFolderSeriesRegexMetadata(config)) return { preset: "folder_series", rules: FOLDER_SERIES_REGEX_METADATA.rules.map((rule) => ({ ...rule })) };
  return config;
}
