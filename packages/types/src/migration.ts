export type MigrationRunState = "draft" | "preflight_failed" | "dry_run_ready" | "running" | "failed" | "completed";

export type UnresolvedReasonCode =
  | "no_isbn_match"
  | "no_file_hash_match"
  | "no_file_path_match"
  | "no_title_author_match"
  | "insufficient_source_data"
  | "ambiguous_isbn_match"
  | "ambiguous_file_hash_match"
  | "ambiguous_file_path_match"
  | "ambiguous_title_author_match"
  | "duplicate_target_match";

export interface MigrationSourceCapabilities {
  ok?: boolean;
  sourceType: string;
  sourceVersion: string | null;
  missingTables: string[];
  warnings: string[];
  counts: Record<string, number>;
}

export interface MigrationSourceApi {
  id: number;
  type: string;
  name: string;
  connectionConfig: Record<string, unknown>;
  capabilities: MigrationSourceCapabilities | null;
  lastValidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MigrationProfileApi {
  id: number;
  sourceId: number;
  name: string;
  userMappings: Array<{ sourceUserId: string; targetUserId: number }>;
  pathMappings: Array<{ sourcePrefix: string; targetPrefix: string }>;
  scope: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MigrationPlanSummary {
  generatedAt?: string;
  status?: string;
  matchedBooks?: number;
  unresolvedBooks?: number;
  duplicateBookMatches?: number;
  unresolvedByReason?: Record<string, number>;
  mappedUsers?: number;
  perUserPreview?: Array<{ sourceUserId: string; targetUserId: number; username: string; counts: Record<string, number> }>;
  artifactSizeBytes?: { plan: number; sourceData: number; total: number };
}

export interface MigrationPlanArtifactApi {
  id: number;
  sourceId: number;
  profileId: number;
  plan: Record<string, unknown>;
  summary: MigrationPlanSummary;
  createdAt: string;
  updatedAt: string;
}

export interface MigrationRunApi {
  id: number;
  sourceId: number;
  profileId: number;
  planArtifactId: number | null;
  state: MigrationRunState;
  currentStage: string | null;
  targetKey: string;
  errorMessage: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MigrationRunMetricApi {
  stage: string;
  entityType: string;
  processed: number;
  imported: number;
  skipped: number;
  unresolved: number;
  failed: number;
  updatedAt: string;
}

export interface MigrationProgressEvent {
  runId: number;
  state: MigrationRunState;
  currentStage: string | null;
  totals: {
    processed: number;
    imported: number;
    skipped: number;
    unresolved: number;
    failed: number;
  };
  metrics: MigrationRunMetricApi[];
}
