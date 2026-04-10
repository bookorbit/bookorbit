import { BadRequestException, ConflictException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { MigrationService } from './migration.service';

const noopEncryption = {
  encryptConfig: (c: Record<string, unknown>) => c,
  decryptConfig: (c: unknown) => c as Record<string, unknown>,
  isConfigured: () => false,
} as never;

function createService(overrides: Partial<Record<string, unknown>> = {}): MigrationService {
  const repo = {
    findSourceById: vi.fn(() =>
      Promise.resolve({
        id: 1,
        type: 'booklore',
        name: 'Booklore',
        connectionConfig: {},
        capabilities: null,
        lastValidatedAt: new Date(),
        createdByUserId: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ),
    listTargetUsersForMapping: vi.fn(() =>
      Promise.resolve([
        {
          id: 10,
          username: 'target-user',
          name: 'Target User',
          email: 'target@example.com',
        },
      ]),
    ),
    listProfiles: vi.fn(() => Promise.resolve([])),
    findProfileById: vi.fn(() =>
      Promise.resolve({
        id: 2,
        sourceId: 1,
        name: 'Booklore Migration',
        version: 1,
        userMappings: [{ sourceUserId: 'src-user', targetUserId: 10 }],
        pathMappings: [],
        scope: { preflight: { pathValidatedAt: new Date().toISOString() } },
        createdByUserId: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ),
    listRuns: vi.fn(() => Promise.resolve([])),
    listSources: vi.fn(() => Promise.resolve([])),
    findRunById: vi.fn(),
    updateRunState: vi.fn(),
    findPlanArtifactById: vi.fn(() =>
      Promise.resolve({
        id: 100,
        sourceId: 1,
        profileId: 2,
        sourceSnapshotHash: 'a',
        profileHash: 'b',
        planHash: 'd',
        plan: {},
        summary: {},
        createdByUserId: 1,
        createdAt: new Date(Date.now() + 1000),
        updatedAt: new Date(),
      }),
    ),
    createRunWithLock: vi.fn(() =>
      Promise.resolve({
        run: null,
        activeRun: {
          id: 77,
          sourceId: 1,
          profileId: 2,
          planArtifactId: 100,
          targetKey: 'projectx',
          state: 'running',
          currentStage: 'init',
          triggeredByUserId: 1,
          startedAt: new Date(),
          endedAt: null,
          errorMessage: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      }),
    ),
    purgeRunState: vi.fn(() => Promise.resolve()),
    listPlanArtifacts: vi.fn(() => Promise.resolve([])),
    ...overrides,
  };

  return new MigrationService(
    repo as never,
    { buildPlan: vi.fn() } as never,
    { start: vi.fn() } as never,
    { getRunProgress: vi.fn(), getRunReport: vi.fn(), exportRunReport: vi.fn() } as never,
    noopEncryption,
  );
}

describe('MigrationService', () => {
  it('rejects live run start when another active run exists for the same source and target', async () => {
    const service = createService();

    await expect(
      service.startLiveRun(
        {
          planArtifactId: 100,
          targetKey: 'projectx',
        },
        1,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows live run start without path validation when no path mappings are configured', async () => {
    const run = {
      id: 78,
      sourceId: 1,
      profileId: 2,
      planArtifactId: 100,
      targetKey: 'projectx',
      state: 'running',
      currentStage: 'init',
      triggeredByUserId: 1,
      startedAt: new Date(),
      endedAt: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const service = createService({
      findProfileById: vi.fn(() =>
        Promise.resolve({
          id: 2,
          sourceId: 1,
          name: 'Booklore Migration',
          version: 1,
          userMappings: [{ sourceUserId: 'src-user', targetUserId: 10 }],
          pathMappings: [],
          scope: {},
          createdByUserId: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
      createRunWithLock: vi.fn(() => Promise.resolve({ run, activeRun: null })),
    });

    await expect(service.startLiveRun({ planArtifactId: 100, targetKey: 'projectx' }, 1)).resolves.toEqual({
      id: 78,
      sourceId: 1,
      profileId: 2,
      planArtifactId: 100,
      state: 'running',
      currentStage: 'init',
      targetKey: 'projectx',
      startedAt: run.startedAt,
      endedAt: null,
      errorMessage: null,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    });
  });

  it('rejects live run start when configured path mappings have not been validated', async () => {
    const service = createService({
      findProfileById: vi.fn(() =>
        Promise.resolve({
          id: 2,
          sourceId: 1,
          name: 'Booklore Migration',
          version: 1,
          userMappings: [{ sourceUserId: 'src-user', targetUserId: 10 }],
          pathMappings: [{ sourcePrefix: '/source', targetPrefix: '/target' }],
          scope: {},
          createdByUserId: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
    });

    await expect(service.startLiveRun({ planArtifactId: 100, targetKey: 'projectx' }, 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('cancelRun', () => {
    it('cancels a running migration', async () => {
      const updatedRun = {
        id: 77,
        sourceId: 1,
        profileId: 2,
        planArtifactId: 100,
        targetKey: 'projectx',
        state: 'failed',
        currentStage: 'cancelled',
        triggeredByUserId: 1,
        startedAt: new Date(),
        endedAt: new Date(),
        errorMessage: 'Migration cancelled by user',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const service = createService({
        findRunById: vi.fn(() =>
          Promise.resolve({
            id: 77,
            sourceId: 1,
            profileId: 2,
            planArtifactId: 100,
            targetKey: 'projectx',
            state: 'running',
            currentStage: 'shared_overlays',
            triggeredByUserId: 1,
            startedAt: new Date(),
            endedAt: null,
            errorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
        updateRunState: vi.fn(() => Promise.resolve(updatedRun)),
      });

      const result = await service.cancelRun(77);
      expect(result.state).toBe('failed');
      expect(result.currentStage).toBe('cancelled');
      expect(result.errorMessage).toBe('Migration cancelled by user');
    });

    it('throws NotFoundException for missing run', async () => {
      const service = createService({
        findRunById: vi.fn(() => Promise.resolve(undefined)),
      });

      await expect(service.cancelRun(999)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException for non-running run', async () => {
      const service = createService({
        findRunById: vi.fn(() =>
          Promise.resolve({
            id: 77,
            state: 'completed',
            sourceId: 1,
            profileId: 2,
            planArtifactId: 100,
            targetKey: 'projectx',
            currentStage: 'completed',
            triggeredByUserId: 1,
            startedAt: new Date(),
            endedAt: new Date(),
            errorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
      });

      await expect(service.cancelRun(77)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws InternalServerErrorException when update fails', async () => {
      const service = createService({
        findRunById: vi.fn(() =>
          Promise.resolve({
            id: 77,
            state: 'running',
            sourceId: 1,
            profileId: 2,
            planArtifactId: 100,
            targetKey: 'projectx',
            currentStage: 'init',
            triggeredByUserId: 1,
            startedAt: new Date(),
            endedAt: null,
            errorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
        updateRunState: vi.fn(() => Promise.resolve(null)),
      });

      await expect(service.cancelRun(77)).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  it('rejects live run start when duplicate book matches exist', async () => {
    const service = createService({
      findPlanArtifactById: vi.fn(() =>
        Promise.resolve({
          id: 100,
          sourceId: 1,
          profileId: 2,
          sourceSnapshotHash: 'a',
          profileHash: 'b',
          planHash: 'd',
          plan: { duplicateBookMatches: [{ targetBookId: 1, sourceBookIds: ['a', 'b'] }] },
          summary: {},
          createdByUserId: 1,
          createdAt: new Date(Date.now() + 1000),
          updatedAt: new Date(),
        }),
      ),
    });

    await expect(service.startLiveRun({ planArtifactId: 100, targetKey: 'projectx' }, 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects live run when source has never been validated', async () => {
    const service = createService({
      findSourceById: vi.fn(() =>
        Promise.resolve({
          id: 1,
          type: 'booklore',
          name: 'Booklore',
          connectionConfig: {},
          capabilities: null,
          lastValidatedAt: null,
          createdByUserId: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
      findPlanArtifactById: vi.fn(() =>
        Promise.resolve({
          id: 100,
          sourceId: 1,
          profileId: 2,
          plan: {},
          summary: {},
          createdByUserId: 1,
          createdAt: new Date(Date.now() + 1000),
          updatedAt: new Date(),
        }),
      ),
    });

    await expect(service.startLiveRun({ planArtifactId: 100, targetKey: 'projectx' }, 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects live run when dry-run plan is stale', async () => {
    const now = new Date();
    const service = createService({
      findSourceById: vi.fn(() =>
        Promise.resolve({
          id: 1,
          type: 'booklore',
          name: 'Booklore',
          connectionConfig: {},
          capabilities: null,
          lastValidatedAt: now,
          createdByUserId: 1,
          createdAt: now,
          updatedAt: new Date(now.getTime() + 5000),
        }),
      ),
      findPlanArtifactById: vi.fn(() =>
        Promise.resolve({
          id: 100,
          sourceId: 1,
          profileId: 2,
          plan: {},
          summary: {},
          createdByUserId: 1,
          createdAt: new Date(now.getTime() - 10000),
          updatedAt: now,
        }),
      ),
    });

    await expect(service.startLiveRun({ planArtifactId: 100, targetKey: 'projectx' }, 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects live run when target users no longer exist', async () => {
    const service = createService({
      findPlanArtifactById: vi.fn(() =>
        Promise.resolve({
          id: 100,
          sourceId: 1,
          profileId: 2,
          plan: {},
          summary: {},
          createdByUserId: 1,
          createdAt: new Date(Date.now() + 1000),
          updatedAt: new Date(),
        }),
      ),
      findProfileById: vi.fn(() =>
        Promise.resolve({
          id: 2,
          sourceId: 1,
          name: 'Booklore Migration',
          version: 1,
          userMappings: [{ sourceUserId: 'src-user', targetUserId: 999 }],
          pathMappings: [],
          scope: { preflight: { pathValidatedAt: new Date().toISOString() } },
          createdByUserId: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
      listTargetUsersForMapping: vi.fn(() =>
        Promise.resolve([{ id: 10, username: 'target-user', name: 'Target User', email: 'target@example.com' }]),
      ),
    });

    await expect(service.startLiveRun({ planArtifactId: 100, targetKey: 'projectx' }, 1)).rejects.toThrow('Target users no longer exist');
  });

  describe('retryFailedRun', () => {
    it('retries a failed run by resetting state to running', async () => {
      const startFn = vi.fn();
      const updatedRun = {
        id: 77,
        sourceId: 1,
        profileId: 2,
        planArtifactId: 100,
        targetKey: 'projectx',
        state: 'running',
        currentStage: 'user_state',
        triggeredByUserId: 1,
        startedAt: new Date(),
        endedAt: null,
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const service = createService({
        findRunById: vi.fn(() =>
          Promise.resolve({
            id: 77,
            sourceId: 1,
            profileId: 2,
            planArtifactId: 100,
            targetKey: 'projectx',
            state: 'failed',
            currentStage: 'user_state',
            triggeredByUserId: 1,
            startedAt: new Date(),
            endedAt: new Date(),
            errorMessage: 'Connection lost',
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
        updateRunState: vi.fn(() => Promise.resolve(updatedRun)),
      });

      (service as any).executor = { start: startFn };

      const result = await service.retryFailedRun(77);
      expect(result.state).toBe('running');
      expect(result.errorMessage).toBeNull();
      expect(startFn).toHaveBeenCalledWith(77);
    });

    it('throws NotFoundException for missing run', async () => {
      const service = createService({
        findRunById: vi.fn(() => Promise.resolve(undefined)),
      });

      await expect(service.retryFailedRun(999)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException for non-failed run', async () => {
      const service = createService({
        findRunById: vi.fn(() =>
          Promise.resolve({
            id: 77,
            state: 'running',
            sourceId: 1,
            profileId: 2,
            planArtifactId: 100,
            targetKey: 'projectx',
            currentStage: 'shared_overlays',
            triggeredByUserId: 1,
            startedAt: new Date(),
            endedAt: null,
            errorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
      });

      await expect(service.retryFailedRun(77)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws ConflictException when another run is already active', async () => {
      const service = createService({
        listRuns: vi.fn(() =>
          Promise.resolve([
            {
              id: 88,
              state: 'running',
              sourceId: 1,
              profileId: 2,
            },
          ]),
        ),
        findRunById: vi.fn(() =>
          Promise.resolve({
            id: 77,
            state: 'failed',
            sourceId: 1,
            profileId: 2,
            planArtifactId: 100,
            targetKey: 'projectx',
            currentStage: 'user_state',
            triggeredByUserId: 1,
            startedAt: new Date(),
            endedAt: new Date(),
            errorMessage: 'error',
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
      });

      await expect(service.retryFailedRun(77)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('resolveDuplicateMatches', () => {
    const duplicatePlanArtifact = {
      id: 100,
      sourceId: 1,
      profileId: 2,
      sourceSnapshotHash: 'a',
      profileHash: 'b',
      planHash: 'd',
      plan: {
        matchedBooks: [{ sourceBookId: 'sb1', targetBookId: 1, strategy: 'isbn' }],
        unresolvedBooks: [{ sourceBookId: 'sb99', title: null, reason: 'no_isbn_match' }],
        duplicateBookMatches: [
          { targetBookId: 5, sourceBookIds: ['sb10', 'sb11'], strategies: ['isbn', 'title_author'], reason: 'duplicate_target_match' },
          {
            targetBookId: 6,
            sourceBookIds: ['sb20', 'sb21', 'sb22'],
            strategies: ['file_hash', 'file_hash', 'title_author'],
            reason: 'duplicate_target_match',
          },
        ],
      },
      sourceData: null,
      summary: {
        status: 'blocked',
        matchedBooks: 1,
        unresolvedBooks: 1,
        duplicateBookMatches: 2,
      },
      createdByUserId: 1,
      createdAt: new Date(Date.now() + 1000),
      updatedAt: new Date(),
    };

    it('resolves duplicate matches by moving selected to matched and others to unresolved', async () => {
      const updateFn = vi.fn((id: number, vals: { plan: unknown; summary: unknown }) => {
        return Promise.resolve({ ...duplicatePlanArtifact, id, plan: vals.plan, summary: vals.summary });
      });
      const service = createService({
        findPlanArtifactById: vi.fn(() => Promise.resolve({ ...duplicatePlanArtifact })),
        updatePlanArtifact: updateFn,
      });

      const result = await service.resolveDuplicateMatches(100, {
        resolutions: [
          { targetBookId: 5, selectedSourceBookId: 'sb10' },
          { targetBookId: 6, selectedSourceBookId: 'sb22' },
        ],
      });

      expect(updateFn).toHaveBeenCalledOnce();
      const updatedPlan = (updateFn.mock.calls as unknown[][])[0][1] as { plan: Record<string, unknown>; summary: Record<string, unknown> };
      const plan = updatedPlan.plan as Record<string, unknown>;
      const matchedBooks = plan.matchedBooks as Array<{ sourceBookId: string; targetBookId: number }>;
      const unresolvedBooks = plan.unresolvedBooks as Array<{ sourceBookId: string }>;
      const duplicateBookMatches = plan.duplicateBookMatches as unknown[];

      expect(matchedBooks).toHaveLength(3);
      expect(matchedBooks.find((m) => m.sourceBookId === 'sb10' && m.targetBookId === 5)).toBeTruthy();
      expect(matchedBooks.find((m) => m.sourceBookId === 'sb22' && m.targetBookId === 6)).toBeTruthy();

      expect(unresolvedBooks).toHaveLength(4);
      expect(unresolvedBooks.find((u) => u.sourceBookId === 'sb11')).toBeTruthy();
      expect(unresolvedBooks.find((u) => u.sourceBookId === 'sb20')).toBeTruthy();
      expect(unresolvedBooks.find((u) => u.sourceBookId === 'sb21')).toBeTruthy();

      expect(duplicateBookMatches).toHaveLength(0);
      expect(result.summary?.status).toBe('ready_for_live_run');
      expect(result.summary?.duplicateBookMatches).toBe(0);
    });

    it('throws NotFoundException for missing artifact', async () => {
      const service = createService({
        findPlanArtifactById: vi.fn(() => Promise.resolve(undefined)),
      });
      await expect(service.resolveDuplicateMatches(999, { resolutions: [{ targetBookId: 1, selectedSourceBookId: 'sb1' }] })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws BadRequestException when no duplicates exist', async () => {
      const service = createService({
        findPlanArtifactById: vi.fn(() =>
          Promise.resolve({
            ...duplicatePlanArtifact,
            plan: { ...duplicatePlanArtifact.plan, duplicateBookMatches: [] },
          }),
        ),
      });
      await expect(service.resolveDuplicateMatches(100, { resolutions: [{ targetBookId: 5, selectedSourceBookId: 'sb10' }] })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws BadRequestException when selected source book is not in the group', async () => {
      const service = createService({
        findPlanArtifactById: vi.fn(() => Promise.resolve({ ...duplicatePlanArtifact })),
      });
      await expect(
        service.resolveDuplicateMatches(100, {
          resolutions: [
            { targetBookId: 5, selectedSourceBookId: 'sb99' },
            { targetBookId: 6, selectedSourceBookId: 'sb22' },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when not all groups are resolved', async () => {
      const service = createService({
        findPlanArtifactById: vi.fn(() => Promise.resolve({ ...duplicatePlanArtifact })),
      });
      await expect(
        service.resolveDuplicateMatches(100, {
          resolutions: [{ targetBookId: 5, selectedSourceBookId: 'sb10' }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('uses explicit duplicate match objects and parses plan user mappings', async () => {
      const artifact = {
        ...duplicatePlanArtifact,
        plan: {
          matchedBooks: [],
          unresolvedBooks: [],
          userMappings: [
            { sourceUserId: 'u1', targetUserId: 10 },
            { sourceUserId: '', targetUserId: 999 },
          ],
          userPreview: [{ sourceUserId: 'u1', targetUserId: 10, username: 'u1', counts: {} }],
          duplicateBookMatches: [
            {
              targetBookId: 5,
              sourceBookIds: ['sb10', 'sb11'],
              strategies: ['isbn', 'title_author'],
              reason: 'duplicate_target_match',
              matches: [
                { sourceBookId: 'sb10', targetBookId: 5, strategy: 'isbn' },
                { sourceBookId: '', targetBookId: Number.NaN, strategy: 'file_hash' },
                { sourceBookId: 'sb11', targetBookId: 5, strategy: 'title_author' },
              ],
            },
          ],
        },
        sourceData: null,
      };
      const updateFn = vi.fn((id: number, vals: { plan: unknown; summary: unknown }) => Promise.resolve({ ...artifact, id, ...vals }));
      const service = createService({
        findPlanArtifactById: vi.fn(() => Promise.resolve(artifact)),
        updatePlanArtifact: updateFn,
      });

      const result = await service.resolveDuplicateMatches(100, {
        resolutions: [{ targetBookId: 5, selectedSourceBookId: 'sb11' }],
      });

      expect(result.summary?.status).toBe('ready_for_live_run');
      expect(updateFn).toHaveBeenCalledWith(
        100,
        expect.objectContaining({
          summary: expect.objectContaining({
            mappedUsers: 1,
          }),
        }),
      );
    });
  });

  describe('createDryRunPlan', () => {
    it('builds and persists a dry-run artifact summary', async () => {
      const createPlanArtifact = vi.fn((values: Record<string, unknown>) =>
        Promise.resolve({
          id: 900,
          sourceId: values.sourceId,
          profileId: values.profileId,
          plan: values.plan,
          summary: values.summary,
          createdByUserId: values.createdByUserId,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );
      const service = createService({ createPlanArtifact });
      const buildPlan = vi.fn(() =>
        Promise.resolve({
          plan: {
            generatedAt: '2026-01-01T00:00:00.000Z',
            snapshot: { books: 2 },
            matchedBooks: [{ sourceBookId: 'b1', targetBookId: 1, strategy: 'isbn' }],
            unresolvedBooks: [{ sourceBookId: 'b2', reason: 'no_isbn_match' }],
            duplicateBookMatches: [{ targetBookId: 77, sourceBookIds: ['b3', 'b4'], strategies: ['isbn', 'title_author'] }],
            userPreview: [{ sourceUserId: 'u1', targetUserId: 10, username: 'reader', counts: { statuses: 1 } }],
          },
          execution: {
            sourceData: {
              books: [{ sourceBookId: 'b1' }],
              users: [{ sourceUserId: 'u1', username: 'reader', email: null, name: null }],
              userBookStatuses: [],
              userFileProgress: [],
              bookmarks: [],
              annotations: [],
              shelves: [],
              shelfBooks: [],
              availableDomains: {},
            },
          },
        }),
      );
      (service as any).planner = { buildPlan };

      const result = await service.createDryRunPlan({ profileId: 2 }, 5);

      expect(buildPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: expect.objectContaining({ id: 2 }),
          source: expect.objectContaining({ id: 1, connectionConfig: {} }),
        }),
      );
      expect(createPlanArtifact).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceId: 1,
          profileId: 2,
          createdByUserId: 5,
          summary: expect.objectContaining({
            status: 'blocked',
            matchedBooks: 1,
            unresolvedBooks: 1,
            duplicateBookMatches: 1,
            unresolvedByReason: { no_isbn_match: 1 },
            artifactSizeBytes: expect.objectContaining({
              plan: expect.any(Number),
              sourceData: expect.any(Number),
              total: expect.any(Number),
            }),
          }),
          sourceSnapshotHash: expect.any(String),
          profileHash: expect.any(String),
          planHash: expect.any(String),
        }),
      );
      expect(result.id).toBe(900);
    });

    it('throws NotFoundException when profile or source is missing', async () => {
      const missingProfileService = createService({
        findProfileById: vi.fn(() => Promise.resolve(null)),
      });
      await expect(missingProfileService.createDryRunPlan({ profileId: 999 }, 1)).rejects.toBeInstanceOf(NotFoundException);

      const missingSourceService = createService({
        findProfileById: vi.fn(() =>
          Promise.resolve({
            id: 2,
            sourceId: 1,
            name: 'Profile',
            version: 1,
            userMappings: [{ sourceUserId: 'src-user', targetUserId: 10 }],
            pathMappings: [],
            scope: {},
            createdByUserId: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
        findSourceById: vi.fn(() => Promise.resolve(null)),
      });
      await expect(missingSourceService.createDryRunPlan({ profileId: 2 }, 1)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('workflow and reporting', () => {
    it('delegates progress/report export methods to reporting service', () => {
      const getRunProgress = vi.fn(() => ({ stage: 'init' }));
      const getRunReport = vi.fn(() => ({ summary: {} }));
      const exportRunReport = vi.fn(() => 'csv-data');
      const service = createService();
      (service as any).reporting = { getRunProgress, getRunReport, exportRunReport };

      expect(service.getRunProgress(7)).toEqual({ stage: 'init' });
      expect(service.getRunReport(7)).toEqual({ summary: {} });
      expect(service.exportRunReport(7, 'csv')).toBe('csv-data');
      expect(getRunProgress).toHaveBeenCalledWith(7);
      expect(getRunReport).toHaveBeenCalledWith(7);
      expect(exportRunReport).toHaveBeenCalledWith(7, 'csv');
    });

    it('returns active workflow bundle and hasActiveRun=true when an active run exists', async () => {
      const now = new Date();
      const service = createService({
        listSources: vi.fn(() =>
          Promise.resolve([
            {
              id: 1,
              type: 'booklore',
              name: 'Source 1',
              connectionConfig: { host: 'a', user: 'u', password: 'pw', database: 'd' },
              capabilities: null,
              lastValidatedAt: now,
              createdByUserId: 1,
              createdAt: now,
              updatedAt: now,
            },
          ]),
        ),
        listProfiles: vi.fn(() =>
          Promise.resolve([
            {
              id: 2,
              sourceId: 1,
              name: 'Profile',
              version: 1,
              userMappings: [],
              pathMappings: [],
              scope: {},
              createdByUserId: 1,
              createdAt: now,
              updatedAt: now,
            },
          ]),
        ),
        listPlanArtifacts: vi.fn(() =>
          Promise.resolve([
            {
              id: 3,
              sourceId: 1,
              profileId: 2,
              sourceSnapshotHash: 'x',
              profileHash: 'y',
              planHash: 'z',
              plan: {},
              sourceData: {},
              summary: {},
              createdByUserId: 1,
              createdAt: now,
              updatedAt: now,
            },
          ]),
        ),
        listRuns: vi.fn(() =>
          Promise.resolve([
            {
              id: 4,
              sourceId: 1,
              profileId: 2,
              planArtifactId: 3,
              targetKey: 'projectx',
              state: 'running',
              currentStage: 'init',
              triggeredByUserId: 1,
              startedAt: now,
              endedAt: null,
              errorMessage: null,
              createdAt: now,
              updatedAt: now,
            },
          ]),
        ),
      });

      const state = await service.getWorkflowState();

      expect(state.hasActiveRun).toBe(true);
      expect(state.active?.source.id).toBe(1);
      expect((state.active?.source.connectionConfig as Record<string, unknown>).password).toBe('********');
      expect(state.active?.profile?.id).toBe(2);
      expect(state.active?.plan?.id).toBe(3);
      expect(state.active?.run?.id).toBe(4);
    });

    it('returns empty workflow state when there are no sources and no active runs', async () => {
      const service = createService({
        listSources: vi.fn(() => Promise.resolve([])),
        listProfiles: vi.fn(() => Promise.resolve([])),
        listPlanArtifacts: vi.fn(() => Promise.resolve([])),
        listRuns: vi.fn(() => Promise.resolve([])),
      });

      await expect(service.getWorkflowState()).resolves.toEqual({
        active: null,
        hasActiveRun: false,
      });
    });
  });
});
