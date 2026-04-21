import { describe, expect, it } from 'vitest';

import { sanitizeSourceForApi, sanitizeProfileForApi, sanitizePlanArtifactForApi, sanitizeRunForApi } from './api-sanitizers';
import type { MigrationSource, MigrationProfile, MigrationPlanArtifact, MigrationRun } from '../../../db/schema';

function makeSource(overrides: Partial<MigrationSource> = {}): MigrationSource {
  return {
    id: 1,
    type: 'booklore',
    name: 'Test Source',
    connectionConfig: { host: 'localhost', password: 'secret123' },
    capabilities: null,
    lastValidatedAt: null,
    createdByUserId: 1,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
    ...overrides,
  };
}

function makeProfile(overrides: Partial<MigrationProfile> = {}): MigrationProfile {
  return {
    id: 2,
    sourceId: 1,
    name: 'Test Profile',
    version: 1,
    userMappings: [{ sourceUserId: 'u1', targetUserId: 10 }],
    pathMappings: [],
    scope: {},
    createdByUserId: 1,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<MigrationPlanArtifact> = {}): MigrationPlanArtifact {
  return {
    id: 3,
    sourceId: 1,
    profileId: 2,
    sourceSnapshotHash: 'hash-a',
    profileHash: 'hash-b',
    planHash: 'hash-c',
    plan: { matchedBooks: [] },
    sourceData: null,
    summary: { status: 'ready' },
    createdByUserId: 1,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
    ...overrides,
  };
}

function makeRun(overrides: Partial<MigrationRun> = {}): MigrationRun {
  return {
    id: 4,
    sourceId: 1,
    profileId: 2,
    planArtifactId: 3,
    targetKey: 'bookorbit',
    state: 'running',
    currentStage: 'init',
    triggeredByUserId: 1,
    startedAt: new Date('2024-01-01'),
    endedAt: null,
    errorMessage: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
    ...overrides,
  };
}

describe('sanitizeSourceForApi', () => {
  it('strips createdByUserId from the response', () => {
    const result = sanitizeSourceForApi(makeSource());
    expect(result).not.toHaveProperty('createdByUserId');
  });

  it('redacts booklore password to sentinel value', () => {
    const result = sanitizeSourceForApi(makeSource({ connectionConfig: { host: 'db', password: 'my-secret' } }));
    expect((result.connectionConfig as Record<string, unknown>).password).toBe('********');
  });

  it('sets password to empty string when no password is set', () => {
    const result = sanitizeSourceForApi(makeSource({ connectionConfig: { host: 'db', password: '' } }));
    expect((result.connectionConfig as Record<string, unknown>).password).toBe('');
  });

  it('does not redact password for non-booklore types', () => {
    const result = sanitizeSourceForApi(makeSource({ type: 'calibre', connectionConfig: { token: 'abc123' } }));
    expect((result.connectionConfig as Record<string, unknown>).token).toBe('abc123');
  });

  it('preserves non-sensitive fields', () => {
    const source = makeSource();
    const result = sanitizeSourceForApi(source);
    expect(result.id).toBe(source.id);
    expect(result.type).toBe(source.type);
    expect(result.name).toBe(source.name);
    expect(result.createdAt).toBe(source.createdAt);
    expect(result.updatedAt).toBe(source.updatedAt);
  });
});

describe('sanitizeProfileForApi', () => {
  it('strips internal fields (version, createdByUserId)', () => {
    const result = sanitizeProfileForApi(makeProfile());
    expect(result).not.toHaveProperty('version');
    expect(result).not.toHaveProperty('createdByUserId');
  });

  it('preserves user and path mappings', () => {
    const profile = makeProfile({
      userMappings: [{ sourceUserId: 'u1', targetUserId: 10 }],
      pathMappings: [{ sourcePrefix: '/src', targetPrefix: '/dst' }],
    });
    const result = sanitizeProfileForApi(profile);
    expect(result.userMappings).toEqual(profile.userMappings);
    expect(result.pathMappings).toEqual(profile.pathMappings);
  });
});

describe('sanitizePlanArtifactForApi', () => {
  it('strips hash fields and createdByUserId', () => {
    const result = sanitizePlanArtifactForApi(makeArtifact());
    expect(result).not.toHaveProperty('sourceSnapshotHash');
    expect(result).not.toHaveProperty('profileHash');
    expect(result).not.toHaveProperty('planHash');
    expect(result).not.toHaveProperty('createdByUserId');
  });

  it('includes plan and summary', () => {
    const artifact = makeArtifact({ plan: { books: [] }, summary: { total: 5 } });
    const result = sanitizePlanArtifactForApi(artifact);
    expect(result.plan).toEqual({ books: [] });
    expect(result.summary).toEqual({ total: 5 });
  });
});

describe('sanitizeRunForApi', () => {
  it('preserves targetKey and strips triggeredByUserId', () => {
    const result = sanitizeRunForApi(makeRun());
    expect(result.targetKey).toBe('bookorbit');
    expect(result).not.toHaveProperty('triggeredByUserId');
  });

  it('includes error message and dates', () => {
    const run = makeRun({ state: 'failed', errorMessage: 'timeout', endedAt: new Date('2024-01-03') });
    const result = sanitizeRunForApi(run);
    expect(result.state).toBe('failed');
    expect(result.errorMessage).toBe('timeout');
    expect(result.endedAt).toEqual(new Date('2024-01-03'));
  });

  it('preserves null fields', () => {
    const result = sanitizeRunForApi(makeRun({ endedAt: null, errorMessage: null }));
    expect(result.endedAt).toBeNull();
    expect(result.errorMessage).toBeNull();
  });
});
