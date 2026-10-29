import type { RegexMetadataFields } from '@bookorbit/types';
import { isRunYearQualifiedName } from '../../../common/utils/series-run-year.utils';
import type { ParsedBookData } from '../extractors/format-extractor.interface';

/** The fields a rule supplies over `base`: all of them when the rule leads, otherwise only what the file lacks. */
export function decideRegexFields(base: ParsedBookData | null, regex: RegexMetadataFields, preferRegex: boolean): RegexMetadataFields {
  const decided: RegexMetadataFields = {};
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
  return decided;
}

export function mergeRegexMetadata(base: ParsedBookData | null, regex: RegexMetadataFields, preferRegex: boolean): ParsedBookData {
  const result: ParsedBookData = base ? { ...base } : { authors: [], genres: [], cover: null };
  const decided = decideRegexFields(base, regex, preferRegex);
  for (const key of ['title', 'seriesName', 'seriesIndex'] as const) {
    if (decided[key] !== undefined) result[key] = decided[key];
  }
  if (decided.authors) result.authors = decided.authors.map((name) => ({ name, sortName: null }));
  if (Object.prototype.hasOwnProperty.call(decided, 'publishedYear')) {
    result.publishedYear = decided.publishedYear;
    result.publishedDate = decided.publishedDate;
  }
  return result;
}
