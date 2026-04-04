import type { MigrationProfile } from '../../../db/schema';
import { sha256Hex } from './hash';

export function buildProfileHash(profile: MigrationProfile): string {
  return sha256Hex({
    sourceId: profile.sourceId,
    version: profile.version,
    userMappings: profile.userMappings,
    pathMappings: profile.pathMappings,
    scope: profile.scope,
  });
}

export function buildPlanHash(args: { sourceSnapshotHash: string; profileHash: string; plan: unknown }): string {
  return sha256Hex({
    sourceSnapshotHash: args.sourceSnapshotHash,
    profileHash: args.profileHash,
    plan: sanitizePlanForHash(args.plan),
  });
}

export function buildSourceSnapshotHash(snapshot: unknown): string {
  if (!isRecord(snapshot)) return sha256Hex(snapshot);
  const sanitized = { ...snapshot };
  delete sanitized.generatedAt;
  return sha256Hex(sanitized);
}

function sanitizePlanForHash(plan: unknown): unknown {
  if (!isRecord(plan)) return plan;

  const sanitized: Record<string, unknown> = { ...plan };
  delete sanitized.generatedAt;

  if (isRecord(sanitized.snapshot)) {
    const snapshot = { ...sanitized.snapshot };
    delete snapshot.generatedAt;
    sanitized.snapshot = snapshot;
  }

  return sanitized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
