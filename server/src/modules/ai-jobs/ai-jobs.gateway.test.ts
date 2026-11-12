import { Permission } from '@bookorbit/types';

import { AiFeatureRegistry } from './ai-feature.registry';
import { AiJobChanges, type AiJobChange } from './ai-job-changes.service';
import { AI_JOBS_CHANGED_EVENT, AI_JOBS_PUSH_MS, AiJobsGateway } from './ai-jobs.gateway';
import { createFakeAiFeature, createFakeFeatureState } from './testing/fake-ai-feature';

const feature = createFakeAiFeature(createFakeFeatureState());
const builder = { id: 4, active: true, isSuperuser: false, permissions: [feature.permission] };
const manager = { id: 2, active: true, isSuperuser: false, permissions: [Permission.ManageAppSettings] };
const reader = { id: 5, active: true, isSuperuser: false, permissions: [] as string[] };

function makeGateway() {
  const authenticator = { authenticateSocket: vi.fn() };
  const registry = new AiFeatureRegistry();
  registry.register(feature);
  const changes = new AiJobChanges();
  const gateway = new AiJobsGateway(authenticator as never, registry, changes);
  const emit = vi.fn();
  const to = vi.fn().mockReturnValue({ emit });
  const serverEmit = vi.fn();
  gateway.server = { to, emit: serverEmit } as never;
  gateway.onModuleInit();
  return { gateway, authenticator, changes, to, emit, serverEmit };
}

function socket() {
  return { id: 'sock-1', data: {}, join: vi.fn().mockResolvedValue(undefined), emit: vi.fn(), disconnect: vi.fn() };
}

function change(overrides: Partial<AiJobChange> = {}): AiJobChange {
  return { id: 'job-1', feature: feature.id, subjectRef: { bookId: 7, fileId: 70 }, requestedBy: 4, kind: 'progress', ...overrides };
}

describe('AiJobsGateway', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('connection', () => {
    it("puts someone who may build in their own room, and a manager in theirs and the managers' room", async () => {
      const { gateway, authenticator } = makeGateway();
      authenticator.authenticateSocket.mockResolvedValueOnce(builder).mockResolvedValueOnce(manager);
      const first = socket();
      const second = socket();
      await gateway.handleConnection(first as never);
      await gateway.handleConnection(second as never);
      expect(first.join).toHaveBeenCalledWith(['ai-jobs:user:4']);
      expect(second.join).toHaveBeenCalledWith(['ai-jobs:managers', 'ai-jobs:user:2']);
      expect(first.disconnect).not.toHaveBeenCalled();
      expect(second.disconnect).not.toHaveBeenCalled();
    });

    it('turns away someone who can neither build nor manage', async () => {
      const { gateway, authenticator } = makeGateway();
      authenticator.authenticateSocket.mockResolvedValue(reader);
      const client = socket();
      await gateway.handleConnection(client as never);
      expect(client.join).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalled();
    });
  });

  describe('pushing changes', () => {
    it('sends progress once per window, only to the requesters and the managers', () => {
      const { changes, to, emit, serverEmit } = makeGateway();
      changes.changed(change());
      changes.changed(change({ id: 'job-2', requestedBy: 9 }));
      changes.changed(change({ id: 'job-3', requestedBy: null }));
      expect(to).not.toHaveBeenCalled();
      vi.advanceTimersByTime(AI_JOBS_PUSH_MS);
      expect(to).toHaveBeenCalledTimes(1);
      expect(to).toHaveBeenCalledWith(['ai-jobs:managers', 'ai-jobs:user:4', 'ai-jobs:user:9']);
      expect(emit).toHaveBeenCalledWith(AI_JOBS_CHANGED_EVENT, { state: false });
      expect(serverEmit).not.toHaveBeenCalled();
    });

    it('tells every socket when a job changed status, since every place in the queue may have moved', () => {
      const { changes, to, serverEmit } = makeGateway();
      changes.changed(change());
      changes.changed(change({ kind: 'state' }));
      vi.advanceTimersByTime(AI_JOBS_PUSH_MS);
      expect(serverEmit).toHaveBeenCalledWith(AI_JOBS_CHANGED_EVENT, { state: true });
      expect(to).not.toHaveBeenCalled();
    });

    it('stops listening when the module goes away', () => {
      const { gateway, changes, serverEmit, to } = makeGateway();
      gateway.onModuleDestroy();
      changes.changed(change({ kind: 'state' }));
      vi.advanceTimersByTime(AI_JOBS_PUSH_MS);
      expect(serverEmit).not.toHaveBeenCalled();
      expect(to).not.toHaveBeenCalled();
    });
  });
});
