import { JobChangesService } from './job-changes.service';
import { JobSourceRegistry } from './job-source.registry';
import { JOBS_CHANGED_EVENT, JOBS_PUSH_MS, JobsGateway } from './jobs.gateway';
import { createFakeJobSource } from './testing/fake-job-source';

const member = { id: 4, active: true, isSuperuser: false, permissions: [] };
const manager = { id: 2, active: true, isSuperuser: false, permissions: [] };

function makeGateway() {
  const authenticator = { authenticateSocket: vi.fn() };
  const registry = new JobSourceRegistry();
  const guides = createFakeJobSource('story-guide', []);
  guides.access = (user) => ({ own: user.id === member.id, all: user.id === manager.id });
  const scans = createFakeJobSource('library-scan', []);
  scans.access = (user) => ({ own: false, all: user.id === manager.id });
  registry.register(guides);
  registry.register(scans);
  const changes = new JobChangesService();
  const gateway = new JobsGateway(authenticator as never, registry, changes);
  const emit = vi.fn();
  const to = vi.fn().mockReturnValue({ emit });
  gateway.server = { to } as never;
  gateway.onModuleInit();
  return { gateway, authenticator, changes, to, emit };
}

function socket() {
  return { id: 'sock-1', data: {}, join: vi.fn().mockResolvedValue(undefined), emit: vi.fn(), disconnect: vi.fn() };
}

describe('JobsGateway', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('joins the rooms of each type the viewer sees, and the everyone room where they see everyone', async () => {
    const { gateway, authenticator } = makeGateway();
    authenticator.authenticateSocket.mockResolvedValueOnce(member).mockResolvedValueOnce(manager);
    const first = socket();
    const second = socket();
    await gateway.handleConnection(first as never);
    await gateway.handleConnection(second as never);
    expect(first.join).toHaveBeenCalledWith(['t:story-guide', 'u:4']);
    expect(second.join).toHaveBeenCalledWith(['t:story-guide', 't:story-guide:all', 't:library-scan', 't:library-scan:all', 'u:2']);
  });

  it('turns away an API key and a viewer who sees no type', async () => {
    const { gateway, authenticator } = makeGateway();
    authenticator.authenticateSocket
      .mockResolvedValueOnce({ ...manager, credential: { kind: 'api_key', keyId: 1 } })
      .mockResolvedValueOnce({ ...member, id: 99 });
    const keyed = socket();
    const outsider = socket();
    await gateway.handleConnection(keyed as never);
    await gateway.handleConnection(outsider as never);
    for (const client of [keyed, outsider]) {
      expect(client.join).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalled();
    }
  });

  it("sends progress once per window to the type's everyone room and the owners", () => {
    const { changes, to, emit } = makeGateway();
    changes.notify({ type: 'story-guide', ownerId: 4, state: false });
    changes.notify({ type: 'story-guide', ownerId: 9, state: false });
    changes.notify({ type: 'story-guide', ownerId: null, state: false });
    expect(to).not.toHaveBeenCalled();
    vi.advanceTimersByTime(JOBS_PUSH_MS);
    expect(to).toHaveBeenCalledTimes(1);
    expect(to).toHaveBeenCalledWith(['t:story-guide:all', 'u:4', 'u:9']);
    expect(emit).toHaveBeenCalledWith(JOBS_CHANGED_EVENT, { type: 'story-guide', state: false });
  });

  it('sends a status change to everyone who sees the type, once per type', () => {
    const { changes, to, emit } = makeGateway();
    changes.notify({ type: 'story-guide', ownerId: 4, state: false });
    changes.notify({ type: 'story-guide', ownerId: 4, state: true });
    changes.notify({ type: 'library-scan', ownerId: null, state: true });
    vi.advanceTimersByTime(JOBS_PUSH_MS);
    expect(to.mock.calls).toEqual([['t:story-guide'], ['t:library-scan']]);
    expect(emit).toHaveBeenCalledWith(JOBS_CHANGED_EVENT, { type: 'story-guide', state: true });
    expect(emit).toHaveBeenCalledWith(JOBS_CHANGED_EVENT, { type: 'library-scan', state: true });
  });

  it('stops listening when the module goes away', () => {
    const { gateway, changes, to } = makeGateway();
    gateway.onModuleDestroy();
    changes.notify({ type: 'story-guide', ownerId: 4, state: true });
    vi.advanceTimersByTime(JOBS_PUSH_MS);
    expect(to).not.toHaveBeenCalled();
  });
});
