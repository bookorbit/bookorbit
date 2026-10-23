import { DrizzleQueryError } from 'drizzle-orm';
import { DatabaseError } from 'pg';

import { MigrationExecutorService } from './migration-executor.service';

function makeExecutorService() {
  const repo = {
    findRunById: vi.fn(),
    findPlanArtifactById: vi.fn(),
    findSourceById: vi.fn(),
    hasStageMetrics: vi.fn().mockResolvedValue(false),
    clearStageMetrics: vi.fn().mockResolvedValue(undefined),
    updateRunState: vi.fn().mockResolvedValue(undefined),
    listRunMetrics: vi.fn().mockResolvedValue([]),
  };
  const sharedOverlays = { import: vi.fn().mockResolvedValue(undefined) };
  const covers = { import: vi.fn().mockResolvedValue(undefined) };
  const userState = { import: vi.fn().mockResolvedValue(undefined) };
  const config = { get: vi.fn().mockReturnValue('/app-data') };
  const encryption = { decryptConfig: vi.fn((value: unknown) => value) };
  const progressGateway = { emitProgress: vi.fn() };
  const notificationService = { notify: vi.fn().mockResolvedValue(undefined) };

  const service = new MigrationExecutorService(
    repo as never,
    sharedOverlays as never,
    covers as never,
    userState as never,
    config as never,
    encryption as never,
    progressGateway as never,
    notificationService as never,
  );

  return { service, repo, sharedOverlays, covers, userState, progressGateway, notificationService };
}

describe('MigrationExecutorService core orchestration', () => {
  it('start ignores duplicate run ids already in progress', async () => {
    const { service } = makeExecutorService();
    const executeSpy = vi.spyOn(service as never, 'execute').mockResolvedValue(undefined);

    service.start(91);
    service.start(91);
    await Promise.resolve();

    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  it('resolveCompletedStages includes only stages that already have persisted metrics', async () => {
    const { service, repo } = makeExecutorService();
    repo.hasStageMetrics.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const completed = await (service as never).resolveCompletedStages(7, 'user_state');

    expect(completed).toEqual(new Set(['shared_overlays']));
    expect(repo.hasStageMetrics).toHaveBeenCalledWith(7, 'shared_overlays');
    expect(repo.hasStageMetrics).toHaveBeenCalledWith(7, 'book_covers');
  });

  it('executeStage skips handler when stage is already marked completed', async () => {
    const { service, repo } = makeExecutorService();
    const handler = vi.fn();

    await (service as never).executeStage(22, 'shared_overlays', new Set(['shared_overlays']), handler);

    expect(handler).not.toHaveBeenCalled();
    expect(repo.clearStageMetrics).not.toHaveBeenCalled();
    expect(repo.updateRunState).not.toHaveBeenCalled();
  });

  it('executeStage clears prior metrics, updates run stage, and executes handler while run is active', async () => {
    const { service, repo } = makeExecutorService();
    repo.findRunById.mockResolvedValue({ id: 22, state: 'running' });
    const handler = vi.fn().mockResolvedValue(undefined);

    await (service as never).executeStage(22, 'shared_overlays', new Set(), handler);

    expect(repo.clearStageMetrics).toHaveBeenCalledWith(22, 'shared_overlays');
    expect(repo.updateRunState).toHaveBeenCalledWith(22, 'running', {
      currentStage: 'shared_overlays',
      errorMessage: null,
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('failRun marks the run as failed and returns the previous stage', async () => {
    const { service, repo } = makeExecutorService();
    repo.findRunById.mockResolvedValue({ id: 5, currentStage: 'book_covers' });

    const failedStage = await (service as never).failRun(5, 'boom');

    expect(failedStage).toBe('book_covers');
    expect(repo.updateRunState).toHaveBeenCalledWith(
      5,
      'failed',
      expect.objectContaining({
        errorMessage: 'boom',
        endedAt: expect.any(Date),
      }),
    );
  });

  it('emitRunProgress aggregates stage metrics and emits gateway event', async () => {
    const { service, repo, progressGateway } = makeExecutorService();
    repo.listRunMetrics.mockResolvedValue([
      {
        stage: 'shared_overlays',
        entityType: 'book_metadata',
        processed: 4,
        imported: 2,
        skipped: 1,
        unresolved: 1,
        failed: 0,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        stage: 'book_covers',
        entityType: 'book_covers',
        processed: 2,
        imported: 2,
        skipped: 0,
        unresolved: 0,
        failed: 0,
        updatedAt: new Date('2026-01-01T00:00:01.000Z'),
      },
    ]);

    await (service as never).emitRunProgress(77, 'running', 'book_covers');

    expect(progressGateway.emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 77,
        state: 'running',
        currentStage: 'book_covers',
        totals: {
          processed: 6,
          imported: 4,
          skipped: 1,
          unresolved: 1,
          failed: 0,
        },
      }),
    );
  });

  it('emitRunProgress swallows progress emission failures', async () => {
    const { service, repo, progressGateway } = makeExecutorService();
    repo.listRunMetrics.mockResolvedValue([
      {
        stage: 'shared_overlays',
        entityType: 'book_metadata',
        processed: 1,
        imported: 1,
        skipped: 0,
        unresolved: 0,
        failed: 0,
        updatedAt: new Date(),
      },
    ]);
    progressGateway.emitProgress.mockImplementation(() => {
      throw new Error('socket down');
    });

    await expect((service as never).emitRunProgress(1, 'running', 'shared_overlays')).resolves.toBeUndefined();
  });

  it('execute marks run as failed when source or plan artifact is missing', async () => {
    const { service, repo } = makeExecutorService();
    repo.findRunById.mockResolvedValue({ id: 5, state: 'running', sourceId: 1, planArtifactId: 9 });
    repo.findPlanArtifactById.mockResolvedValue(null);
    repo.findSourceById.mockResolvedValue({ id: 1, type: 'booklore' });

    await (service as never).execute(5);

    expect(repo.updateRunState).toHaveBeenCalledWith(
      5,
      'failed',
      expect.objectContaining({
        errorMessage: 'Migration run references missing source or plan artifact',
      }),
    );
  });

  it('execute marks run as failed when run has no dry-run plan artifact id', async () => {
    const { service, repo, sharedOverlays, covers, userState } = makeExecutorService();
    repo.findRunById.mockResolvedValue({ id: 8, state: 'running', sourceId: 1, planArtifactId: null, currentStage: 'init' });

    await (service as never).execute(8);

    expect(repo.updateRunState).toHaveBeenCalledWith(
      8,
      'failed',
      expect.objectContaining({
        errorMessage: 'Migration run is missing a dry-run plan artifact',
      }),
    );
    expect(sharedOverlays.import).not.toHaveBeenCalled();
    expect(covers.import).not.toHaveBeenCalled();
    expect(userState.import).not.toHaveBeenCalled();
  });

  it('execute marks run as failed when plan artifact source data is missing', async () => {
    const { service, repo } = makeExecutorService();
    repo.findRunById.mockResolvedValue({ id: 9, state: 'running', sourceId: 1, planArtifactId: 10, currentStage: 'init' });
    repo.findPlanArtifactById.mockResolvedValue({
      id: 10,
      plan: { matchedBooks: [], unresolvedBooks: [] },
      sourceData: null,
    });
    repo.findSourceById.mockResolvedValue({
      id: 1,
      type: 'booklore',
      connectionConfig: {
        host: 'localhost',
        user: 'reader',
        password: 'secret',
        database: 'booklore',
        mediaRootPath: '/tmp/booklore-media',
      },
    });

    await (service as never).execute(9);

    expect(repo.updateRunState).toHaveBeenCalledWith(
      9,
      'failed',
      expect.objectContaining({
        errorMessage: 'Plan artifact is missing cached source data. Re-run dry-run.',
      }),
    );
  });

  it('execute runs stages in order and marks run completed', async () => {
    const { service, repo, sharedOverlays, covers, userState, progressGateway } = makeExecutorService();
    repo.findRunById.mockResolvedValue({ id: 11, state: 'running', sourceId: 1, planArtifactId: 44, currentStage: 'init' });
    repo.findPlanArtifactById.mockResolvedValue({
      id: 44,
      plan: { matchedBooks: [{ sourceBookId: 'source-1', targetBookId: 901 }], unresolvedBooks: [] },
      sourceData: { books: [] },
    });
    repo.findSourceById.mockResolvedValue({
      id: 1,
      type: 'booklore',
      connectionConfig: {
        host: 'localhost',
        user: 'reader',
        password: 'secret',
        database: 'booklore',
        mediaRootPath: '/tmp/booklore-media',
      },
    });

    await (service as never).execute(11);

    expect(sharedOverlays.import).toHaveBeenCalledWith(11, expect.any(Object), expect.any(Function));
    expect(covers.import).toHaveBeenCalledWith(11, expect.any(Object), '/app-data', '/tmp/booklore-media', expect.any(Function));
    expect(userState.import).toHaveBeenCalledWith(11, expect.any(Object), expect.any(Function));
    expect(repo.updateRunState).toHaveBeenCalledWith(
      11,
      'completed',
      expect.objectContaining({
        currentStage: 'completed',
        errorMessage: null,
      }),
    );

    const emittedStates = progressGateway.emitProgress.mock.calls.map((call) => call[0].state);
    expect(emittedStates).toEqual(['running', 'running', 'completed']);
  });

  describe('when a stage fails', () => {
    const constraintMessage = 'new row for relation "user_book_status" violates check constraint "user_book_status_finished_after_started_chk"';

    function setUpFailingRun(error: unknown) {
      const harness = makeExecutorService();
      harness.repo.findRunById.mockResolvedValue({
        id: 13,
        state: 'running',
        sourceId: 1,
        planArtifactId: 45,
        currentStage: 'user_state',
        triggeredByUserId: 3,
      });
      harness.repo.findPlanArtifactById.mockResolvedValue({
        id: 45,
        plan: { matchedBooks: [], unresolvedBooks: [] },
        sourceData: { books: [] },
      });
      harness.repo.findSourceById.mockResolvedValue({
        id: 1,
        type: 'audiobookshelf',
        connectionConfig: { mode: 'api', baseUrl: 'http://abs.local', apiToken: 'token', allowPrivateNetwork: true },
      });
      harness.userState.import.mockRejectedValue(error);
      return harness;
    }

    it("records the database's reason rather than the failed SQL and its row values", async () => {
      // Issue 1678: the stored message was Drizzle's query text, whose params listed `read`, so the
      // report blamed the status value instead of the violated constraint.
      const queryError = new DrizzleQueryError(
        'insert into "user_book_status" ("user_id", "book_id", "status") values ($1, $2, $3)',
        [1, 2159, 'read'],
        Object.assign(new DatabaseError(constraintMessage, 0, 'error'), { code: '23514' }),
      );
      const { service, repo, notificationService } = setUpFailingRun(queryError);

      await (service as never).execute(13);

      expect(repo.updateRunState).toHaveBeenCalledWith(13, 'failed', expect.objectContaining({ errorMessage: constraintMessage }));
      expect(notificationService.notify).toHaveBeenCalledWith(expect.objectContaining({ message: constraintMessage, meta: { runId: 13 } }));
    });

    it('records a non-query failure by its own message', async () => {
      const { service, repo, notificationService } = setUpFailingRun(
        new Error('Audiobookshelf request failed', { cause: new Error('socket hang up') }),
      );

      await (service as never).execute(13);

      expect(repo.updateRunState).toHaveBeenCalledWith(13, 'failed', expect.objectContaining({ errorMessage: 'Audiobookshelf request failed' }));
      expect(notificationService.notify).toHaveBeenCalledWith(expect.objectContaining({ message: 'Audiobookshelf request failed' }));
    });
  });

  it('execute exits cleanly without failing the run when interrupted', async () => {
    const { service, repo, sharedOverlays, progressGateway } = makeExecutorService();
    const running = { id: 12, state: 'running', sourceId: 1, planArtifactId: 77, currentStage: 'init' };
    repo.findRunById.mockResolvedValueOnce(running).mockResolvedValueOnce({ ...running, state: 'cancelled' });
    repo.findPlanArtifactById.mockResolvedValue({
      id: 77,
      plan: { matchedBooks: [], unresolvedBooks: [] },
      sourceData: { books: [] },
    });
    repo.findSourceById.mockResolvedValue({
      id: 1,
      type: 'booklore',
      connectionConfig: {
        host: 'localhost',
        user: 'reader',
        password: 'secret',
        database: 'booklore',
        mediaRootPath: '/tmp/booklore-media',
      },
    });

    await (service as never).execute(12);

    const terminalStates = repo.updateRunState.mock.calls.map((call) => call[1]);
    expect(terminalStates).not.toContain('failed');
    expect(terminalStates).not.toContain('completed');
    expect(sharedOverlays.import).not.toHaveBeenCalled();
    expect(progressGateway.emitProgress).not.toHaveBeenCalled();
  });

  it('resolveSourceMediaRootPath handles non-booklore and missing media root paths', () => {
    const { service } = makeExecutorService();

    expect((service as never).resolveSourceMediaRootPath('custom', { foo: 'bar' })).toBeNull();
    expect(
      (service as never).resolveSourceMediaRootPath('booklore', {
        host: 'localhost',
        user: 'reader',
        password: 'secret',
        database: 'booklore',
      }),
    ).toBeNull();
  });
});
