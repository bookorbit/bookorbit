import type { RegexMetadataFields } from '@bookorbit/types';
import type { ParsedBookData } from '../extractors/format-extractor.interface';

export function mergeRegexMetadata(base: ParsedBookData | null, regex: RegexMetadataFields, preferRegex: boolean): ParsedBookData {
  const result: ParsedBookData = base ? { ...base } : { authors: [], genres: [], cover: null };
  for (const key of ['title', 'seriesName', 'seriesIndex'] as const) {
    if (regex[key] !== undefined && (preferRegex || !result[key]?.trim())) result[key] = regex[key];
  }
  if (regex.authors?.length && (preferRegex || !result.authors.length)) {
    result.authors = regex.authors.map((name) => ({ name, sortName: null }));
  }
  // Date and year describe the same value; a higher-priority year must not retain a conflicting date.
  if (regex.publishedYear !== undefined && (preferRegex || (!result.publishedYear && !result.publishedDate))) {
    result.publishedYear = regex.publishedYear;
    result.publishedDate = regex.publishedDate;
  }
  return result;
}
