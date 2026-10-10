import {
  REGEX_METADATA_GROUPS,
  type RegexMetadataConfig,
  type RegexMetadataDiagnostic,
  type RegexMetadataFields,
  type RegexMetadataPreview,
} from '@bookorbit/types';
import { isPublishedDateKey, parsePublishedYear } from '../../../common/utils/published-date.utils';

export interface RegexMetadataTask {
  config: RegexMetadataConfig;
  inputPath?: string;
}

export function evaluateRegexMetadata({ config, inputPath }: RegexMetadataTask): RegexMetadataPreview {
  const result: RegexMetadataPreview = {
    inputPath: inputPath ?? '',
    matched: false,
    ruleIndex: null,
    groups: {},
    metadata: {},
    diagnostics: [],
  };
  const compiled: RegExp[] = [];
  for (const [ruleIndex, rule] of config.rules.entries()) {
    try {
      const regex = new RegExp(rule.pattern, rule.flags);
      // The empty first alternative exposes group names without executing the user's pattern.
      const groups = Object.keys(new RegExp(`|(?:${rule.pattern})`, rule.flags).exec('')?.groups ?? {});
      if (!groups.some((group) => (REGEX_METADATA_GROUPS as readonly string[]).includes(group))) {
        result.diagnostics.push({ code: 'missing_group', ruleIndex });
      }
      if (groups.includes('author') && groups.includes('authors')) {
        result.diagnostics.push({ code: 'conflicting_authors', ruleIndex });
      }
      compiled.push(regex);
    } catch {
      result.diagnostics.push({ code: 'invalid_pattern', ruleIndex });
    }
  }
  if (result.diagnostics.length || inputPath === undefined) return result;

  for (const [ruleIndex, regex] of compiled.entries()) {
    const match = regex.exec(inputPath);
    if (!match?.groups) continue;
    const groups = Object.fromEntries(Object.entries(match.groups).filter((entry): entry is [string, string] => entry[1] !== undefined));
    const metadata = normalizeGroups(groups, ruleIndex, result.diagnostics);
    if (!Object.keys(metadata).length) continue;
    return { ...result, matched: true, ruleIndex, groups, metadata };
  }
  return result;
}

function normalizeGroups(groups: Record<string, string>, ruleIndex: number, diagnostics: RegexMetadataDiagnostic[]): RegexMetadataFields {
  const metadata: RegexMetadataFields = {};
  for (const [group, field, limit] of [
    ['title', 'title', 1000],
    ['series', 'seriesName', 200],
    ['seriesIndex', 'seriesIndex', 20],
  ] as const) {
    const value = groups[group]?.trim();
    if (!value) continue;
    if (value.length > limit) diagnostics.push({ code: 'invalid_value', ruleIndex, field: group });
    else metadata[field] = value;
  }
  const author = groups.author?.trim();
  const authors = author
    ? [author]
    : groups.authors
        ?.split(';')
        .map((value) => value.trim())
        .filter(Boolean);
  if (authors?.length) {
    if (authors.some((value) => value.length > 200)) diagnostics.push({ code: 'invalid_value', ruleIndex, field: 'authors' });
    else metadata.authors = [...new Set(authors)];
  }
  const year = groups.publishedYear?.trim();
  if (year) {
    const parsed = /^\d{4}$/.test(year) ? parsePublishedYear(year) : undefined;
    if (parsed === undefined) diagnostics.push({ code: 'invalid_value', ruleIndex, field: 'publishedYear' });
    else metadata.publishedYear = parsed;
  }
  const date = groups.publishedDate?.trim();
  if (date) {
    if (!isPublishedDateKey(date)) diagnostics.push({ code: 'invalid_value', ruleIndex, field: 'publishedDate' });
    else {
      metadata.publishedDate = date;
      metadata.publishedYear = Number(date.slice(0, 4));
    }
  }
  return metadata;
}
