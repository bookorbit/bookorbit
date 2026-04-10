import type { RequestUser } from '../../common/types/request-user';
import { MigrationController } from './migration.controller';

function makeUser(overrides?: Partial<RequestUser>): RequestUser {
  return {
    id: 42,
    username: 'admin',
    name: 'Admin',
    email: null,
    active: true,
    isSuperuser: true,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,
  };
}

function makeReply() {
  const headers: Record<string, unknown> = {};
  const reply = {
    header: vi.fn(),
    send: vi.fn(),
  };
  reply.header.mockImplementation((key: string, value: unknown) => {
    headers[key] = value;
    return reply as never;
  });
  reply.send.mockImplementation((payload: unknown) => payload as never);

  return { reply: reply as never, headers };
}

function makeController() {
  const sourceService = {
    listSupportedSourceTypes: vi.fn(),
    testSource: vi.fn(),
    createSource: vi.fn(),
    validateSourceById: vi.fn(),
    getSourcePathPrefixes: vi.fn(),
  };
  const profileService = {
    listTargetUsers: vi.fn(),
    suggestUserMappings: vi.fn(),
    validatePathMappings: vi.fn(),
    createProfile: vi.fn(),
  };
  const runService = {
    getWorkflowState: vi.fn(),
    createDryRunPlan: vi.fn(),
    resolveDuplicateMatches: vi.fn(),
    startLiveRun: vi.fn(),
    cancelRun: vi.fn(),
    retryFailedRun: vi.fn(),
    getRunProgress: vi.fn(),
    getRunReport: vi.fn(),
    exportRunReport: vi.fn(),
  };

  return {
    controller: new MigrationController(sourceService as never, profileService as never, runService as never),
    sourceService,
    profileService,
    runService,
  };
}

describe('MigrationController', () => {
  it('delegates source, profile, and run endpoints', async () => {
    const { controller, sourceService, profileService, runService } = makeController();
    const user = makeUser({ id: 7 });

    sourceService.listSupportedSourceTypes.mockResolvedValue(['booklore']);
    sourceService.testSource.mockResolvedValue({ ok: true });
    runService.getWorkflowState.mockResolvedValue({ running: false });
    profileService.listTargetUsers.mockResolvedValue([{ id: 1 }]);
    sourceService.createSource.mockResolvedValue({ id: 3 });
    sourceService.validateSourceById.mockResolvedValue({ ok: true });
    sourceService.getSourcePathPrefixes.mockResolvedValue(['/media/books']);
    profileService.suggestUserMappings.mockResolvedValue([{ sourceUserId: 'u1', targetUserId: 1 }]);
    profileService.validatePathMappings.mockResolvedValue({ valid: true, sample: [] });
    profileService.createProfile.mockResolvedValue({ id: 5 });
    runService.createDryRunPlan.mockResolvedValue({ id: 9 });
    runService.resolveDuplicateMatches.mockResolvedValue({ resolved: 1 });
    runService.startLiveRun.mockResolvedValue({ id: 11 });
    runService.cancelRun.mockResolvedValue({ cancelled: true });
    runService.retryFailedRun.mockResolvedValue({ retried: true });
    runService.getRunProgress.mockResolvedValue({ state: 'running' });
    runService.getRunReport.mockResolvedValue({ runId: 11 });

    await expect(controller.listSupportedTypes()).resolves.toEqual(['booklore']);
    await expect(controller.testSource({ type: 'booklore' } as never)).resolves.toEqual({ ok: true });
    await expect(controller.getWorkflowState()).resolves.toEqual({ running: false });
    await expect(controller.listTargetUsers()).resolves.toEqual([{ id: 1 }]);

    await expect(controller.createSource({ type: 'booklore' } as never, user)).resolves.toEqual({ id: 3 });
    expect(sourceService.createSource).toHaveBeenCalledWith({ type: 'booklore' }, 7);

    await expect(controller.validateSourceById(3)).resolves.toEqual({ ok: true });
    await expect(controller.getSourcePathPrefixes(3)).resolves.toEqual(['/media/books']);
    await expect(controller.suggestUserMappings(3)).resolves.toEqual([{ sourceUserId: 'u1', targetUserId: 1 }]);
    await expect(controller.validatePathMappings(3, { pathMappings: [] } as never)).resolves.toEqual({ valid: true, sample: [] });
    await expect(controller.createProfile({ sourceId: 3 } as never, user)).resolves.toEqual({ id: 5 });
    expect(profileService.createProfile).toHaveBeenCalledWith({ sourceId: 3 }, 7);

    await expect(controller.createDryRunPlan({ profileId: 5 } as never, user)).resolves.toEqual({ id: 9 });
    expect(runService.createDryRunPlan).toHaveBeenCalledWith({ profileId: 5 }, 7);

    await expect(controller.resolveDuplicateMatches(9, { resolutions: [] } as never)).resolves.toEqual({ resolved: 1 });
    await expect(controller.startLiveRun({ planArtifactId: 9 } as never, user)).resolves.toEqual({ id: 11 });
    expect(runService.startLiveRun).toHaveBeenCalledWith({ planArtifactId: 9 }, 7);

    await expect(controller.cancelRun(11)).resolves.toEqual({ cancelled: true });
    await expect(controller.retryRun(11)).resolves.toEqual({ retried: true });
    await expect(controller.getRunProgress(11)).resolves.toEqual({ state: 'running' });
    await expect(controller.getRunReport(11)).resolves.toEqual({ runId: 11 });
  });

  it('exports run report with attachment headers from service response', async () => {
    const { controller, runService } = makeController();
    const { reply, headers } = makeReply();

    runService.exportRunReport.mockResolvedValue({
      contentType: 'application/json',
      fileName: 'migration-run-4-report.json',
      content: '{"ok":true}',
    });

    const result = await controller.exportRunReport(4, 'json', reply);

    expect(runService.exportRunReport).toHaveBeenCalledWith(4, 'json');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Content-Disposition']).toBe('attachment; filename="migration-run-4-report.json"');
    expect(result).toBe('{"ok":true}');
  });
});
