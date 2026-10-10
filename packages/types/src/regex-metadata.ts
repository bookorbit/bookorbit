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

export interface RegexMetadataConfig {
  rules: RegexMetadataRule[];
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
