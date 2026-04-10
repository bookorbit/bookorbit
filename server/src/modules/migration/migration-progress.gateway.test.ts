import { Permission } from '@projectx/types';

import type { RequestUser } from '../../common/types/request-user';
import { MigrationProgressGateway } from './migration-progress.gateway';

function makeUser(overrides?: Partial<RequestUser>): RequestUser {
  return {
    id: 7,
    username: 'admin',
    name: 'Admin',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,
  };
}

function makeGateway() {
  const jwtService = {
    verify: vi.fn(),
  };
  const authService = {
    validateUser: vi.fn(),
  };
  const repo = {
    findRunById: vi.fn(),
    listRunMetrics: vi.fn(),
  };

  const gateway = new MigrationProgressGateway(jwtService as never, authService as never, repo as never);
  return { gateway, jwtService, authService, repo };
}

function makeClient() {
  return {
    id: 'socket-1',
    handshake: { auth: { token: 'token-1' } },
    data: {},
    disconnect: vi.fn(),
    join: vi.fn(),
    emit: vi.fn(),
  };
}

describe('MigrationProgressGateway', () => {
  it('accepts websocket connections for authorized users', async () => {
    const { gateway, jwtService, authService } = makeGateway();
    const client = makeClient();
    jwtService.verify.mockReturnValue({ sub: 7, ver: 1 });
    authService.validateUser.mockResolvedValue(makeUser({ permissions: [Permission.ManageAppSettings] }));

    await gateway.handleConnection(client as never);

    expect(jwtService.verify).toHaveBeenCalledWith('token-1');
    expect(authService.validateUser).toHaveBeenCalledWith(7, 1);
    expect(client.disconnect).not.toHaveBeenCalled();
    expect((client.data as { user?: RequestUser }).user?.id).toBe(7);
  });

  it('rejects websocket connections when token is missing or permission is absent', async () => {
    const { gateway, jwtService, authService } = makeGateway();
    const missingTokenClient = makeClient();
    missingTokenClient.handshake.auth = {};

    await gateway.handleConnection(missingTokenClient as never);
    expect(missingTokenClient.disconnect).toHaveBeenCalledTimes(1);

    const forbiddenClient = makeClient();
    jwtService.verify.mockReturnValue({ sub: 7, ver: 1 });
    authService.validateUser.mockResolvedValue(makeUser({ permissions: [] }));

    await gateway.handleConnection(forbiddenClient as never);
    expect(forbiddenClient.disconnect).toHaveBeenCalledTimes(1);
  });

  it('subscribes to run room and emits computed progress snapshot', async () => {
    const { gateway, repo } = makeGateway();
    const client = makeClient();
    (client.data as { user: RequestUser }).user = makeUser({ permissions: [Permission.ManageAppSettings] });
    repo.findRunById.mockResolvedValue({
      id: 12,
      sourceId: 1,
      profileId: 2,
      planArtifactId: 3,
      state: 'running',
      currentStage: 'user_state',
      targetKey: 'default',
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      endedAt: null,
      errorMessage: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    repo.listRunMetrics.mockResolvedValue([
      {
        stage: 'shared_overlays',
        entityType: 'book_metadata',
        processed: 3,
        imported: 2,
        skipped: 1,
        unresolved: 0,
        failed: 0,
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
      {
        stage: 'user_state',
        entityType: 'reading_progress',
        processed: 5,
        imported: 4,
        skipped: 0,
        unresolved: 1,
        failed: 0,
        updatedAt: new Date('2026-01-02T00:01:00.000Z'),
      },
    ]);

    await gateway.handleSubscribeRun(client as never, 12);

    expect(client.join).toHaveBeenCalledWith('run:12');
    expect(client.emit).toHaveBeenCalledWith(
      'migration:progress',
      expect.objectContaining({
        runId: 12,
        state: 'running',
        currentStage: 'user_state',
        totals: {
          processed: 8,
          imported: 6,
          skipped: 1,
          unresolved: 1,
          failed: 0,
        },
      }),
    );
  });

  it('does nothing on subscribe when no authenticated user or run exists', async () => {
    const { gateway, repo } = makeGateway();
    const noUserClient = makeClient();

    await gateway.handleSubscribeRun(noUserClient as never, 4);
    expect(noUserClient.join).not.toHaveBeenCalled();

    const client = makeClient();
    (client.data as { user: RequestUser }).user = makeUser({ permissions: [Permission.ManageAppSettings] });
    repo.findRunById.mockResolvedValue(null);

    await gateway.handleSubscribeRun(client as never, 4);
    expect(client.join).toHaveBeenCalledWith('run:4');
    expect(client.emit).not.toHaveBeenCalled();
  });

  it('emits progress updates to room-scoped subscribers', () => {
    const { gateway } = makeGateway();
    const emit = vi.fn();
    const to = vi.fn().mockReturnValue({ emit });
    (gateway as { server: { to: typeof to } }).server = { to };

    gateway.emitProgress({
      runId: 5,
      state: 'running',
      currentStage: 'shared_overlays',
      totals: { processed: 1, imported: 1, skipped: 0, unresolved: 0, failed: 0 },
      metrics: [],
    });

    expect(to).toHaveBeenCalledWith('run:5');
    expect(emit).toHaveBeenCalledWith(
      'migration:progress',
      expect.objectContaining({
        runId: 5,
      }),
    );
  });
});
