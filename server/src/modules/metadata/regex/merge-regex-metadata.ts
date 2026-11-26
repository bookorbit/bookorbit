import type { RegexMetadataFields, SeriesUnit } from '@bookorbit/types';
import { isRunYearQualifiedName } from '../../../common/utils/series-run-year.utils';
import type { ParsedBookData } from '../extractors/format-extractor.interface';

/** What path rules supply over a book's own metadata. A null unit clears a stored one. */
export type DecidedRegexFields = Omit<RegexMetadataFields, 'seriesUnit' | 'seriesVolumeIndex'> & {
  seriesUnit?: SeriesUnit | null;
  seriesVolumeIndex?: string | null;
};

export interface RegexDecisionOptions {
  /** Units are only kept for comic files; everywhere else a marker is part of a prose title. */
  units: boolean;
}

/** The fields a rule supplies over `base`: all of them when the rule leads, otherwise only what the file lacks. */
export function decideRegexFields(
  base: ParsedBookData | null,
  regex: RegexMetadataFields,
  preferRegex: boolean,
  options: RegexDecisionOptions = { units: false },
): DecidedRegexFields {
  const decided: DecidedRegexFields = {};
  for (const key of ['title', 'seriesName', 'seriesIndex'] as const) {
    if (regex[key] !== undefined && (preferRegex || !base?.[key]?.trim())) decided[key] = regex[key];
  }
  // ComicInfo names a run without its start year; a "Batman (2016)" folder names the same run more
  // precisely, and only the year keeps it apart from every other "Batman".
  if (!preferRegex && isRunYearQualifiedName(regex.seriesName, base?.seriesName)) decided.seriesName = regex.seriesName;
  if (regex.authors?.length && (preferRegex || !base?.authors.length)) decided.authors = regex.authors;
  // Date and year describe the same value; a higher-priority year must not retain a conflicting date.
  if (regex.publishedYear !== undefined && (preferRegex || (!base?.publishedYear && !base?.publishedDate))) {
    decided.publishedYear = regex.publishedYear;
    decided.publishedDate = regex.publishedDate;
  }
  // The unit describes the number the rule read, so it only holds where the book keeps that number:
  // the rule's own, or a ComicInfo number that says the same.
  if (options.units && regex.seriesIndex !== undefined) {
    const keepsNumber = decided.seriesIndex !== undefined || sameSeriesNumber(base?.seriesIndex, regex.seriesIndex);
    if (keepsNumber) {
      decided.seriesUnit = regex.seriesUnit ?? null;
      decided.seriesVolumeIndex = regex.seriesVolumeIndex ?? null;
    }
  }
  return decided;
}

export function mergeRegexMetadata(
  base: ParsedBookData | null,
  regex: RegexMetadataFields,
  preferRegex: boolean,
  options: RegexDecisionOptions = { units: false },
): ParsedBookData {
  const result: ParsedBookData = base ? { ...base } : { authors: [], genres: [], cover: null };
  const decided = decideRegexFields(base, regex, preferRegex, options);
  for (const key of ['title', 'seriesName', 'seriesIndex'] as const) {
    if (decided[key] !== undefined) result[key] = decided[key];
  }
  if (decided.seriesUnit !== undefined) {
    result.seriesUnit = decided.seriesUnit;
    result.seriesVolumeIndex = decided.seriesVolumeIndex ?? null;
  }
  if (decided.authors) result.authors = decided.authors.map((name) => ({ name, sortName: null }));
  if (Object.prototype.hasOwnProperty.call(decided, 'publishedYear')) {
    result.publishedYear = decided.publishedYear;
    result.publishedDate = decided.publishedDate;
  }
  return result;
}

function sameSeriesNumber(left: string | null | undefined, right: string): boolean {
  const value = left?.trim();
  return !!value && Number(value) === Number(right);
}
