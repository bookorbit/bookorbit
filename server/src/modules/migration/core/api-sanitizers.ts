import { asRecord } from './coerce';
import { PASSWORD_REDACTED_SENTINEL } from './connection-config';

import type { MigrationSource, MigrationProfile, MigrationPlanArtifact, MigrationRun } from '../../../db/schema';

export interface ApiMigrationSource {
  id: number;
  type: string;
  name: string;
  connectionConfig: unknown;
  capabilities: MigrationSource['capabilities'];
  lastValidatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiMigrationProfile {
  id: number;
  sourceId: number;
  name: string;
  userMappings: MigrationProfile['userMappings'];
  pathMappings: MigrationProfile['pathMappings'];
  scope: MigrationProfile['scope'];
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiMigrationPlanArtifact {
  id: number;
  sourceId: number;
  profileId: number;
  plan: MigrationPlanArtifact['plan'];
  summary: MigrationPlanArtifact['summary'];
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiMigrationRun {
  id: number;
  sourceId: number;
  profileId: number;
  planArtifactId: number | null;
  state: MigrationRun['state'];
  currentStage: string | null;
  targetKey: string;
  startedAt: Date | null;
  endedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function sanitizeSourceForApi(source: MigrationSource): ApiMigrationSource {
  return {
    id: source.id,
    type: source.type,
    name: source.name,
    connectionConfig: redactConnectionConfig(source.type, source.connectionConfig),
    capabilities: source.capabilities,
    lastValidatedAt: source.lastValidatedAt,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

export function sanitizeProfileForApi(profile: MigrationProfile): ApiMigrationProfile {
  return {
    id: profile.id,
    sourceId: profile.sourceId,
    name: profile.name,
    userMappings: profile.userMappings,
    pathMappings: profile.pathMappings,
    scope: profile.scope,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export function sanitizePlanArtifactForApi(artifact: MigrationPlanArtifact): ApiMigrationPlanArtifact {
  return {
    id: artifact.id,
    sourceId: artifact.sourceId,
    profileId: artifact.profileId,
    plan: artifact.plan,
    summary: artifact.summary,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  };
}

export function sanitizeRunForApi(run: MigrationRun): ApiMigrationRun {
  return {
    id: run.id,
    sourceId: run.sourceId,
    profileId: run.profileId,
    planArtifactId: run.planArtifactId,
    state: run.state,
    currentStage: run.currentStage,
    targetKey: run.targetKey,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function redactConnectionConfig(type: string, raw: unknown): unknown {
  const config = asRecord(raw);
  if (type !== 'booklore') return config;

  return {
    ...config,
    password: typeof config.password === 'string' && config.password.length > 0 ? PASSWORD_REDACTED_SENTINEL : '',
  };
}
