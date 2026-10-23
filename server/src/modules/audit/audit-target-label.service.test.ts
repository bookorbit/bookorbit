import { AuditAction, AuditResource } from '@bookorbit/types';

import { AuditTargetLabelService } from './audit-target-label.service';

function row(overrides: Record<string, unknown>) {
  return {
    id: 1,
    userId: 1,
    actorUsername: 'neon',
    action: AuditAction.LibraryUpdate,
    resource: AuditResource.Library,
    resourceId: 88,
    resourceLabel: null,
    description: 'Updated library #88',
    ip: '127.0.0.1',
    meta: null,
    createdAt: new Date('2026-10-14T22:37:27Z'),
    ...overrides,
  };
}

function makeService(live: Record<string, string> = {}, snapshots: Record<string, string> = {}) {
  const repository = {
    findLiveLabels: vi.fn(() => Promise.resolve(new Map(Object.entries(live)))),
    findSnapshotLabels: vi.fn(() => Promise.resolve(new Map(Object.entries(snapshots)))),
  };
  return { service: new AuditTargetLabelService(repository as never), repository };
}

describe('AuditTargetLabelService', () => {
  it('names a target that still exists by its current name', async () => {
    const { service, repository } = makeService({ 'library:88': 'Novels', 'user:1': 'Neon' });

    const [result] = await service.attach([row({ resourceLabel: 'Old name' })] as never);

    expect(result).toMatchObject({ actorName: 'Neon', targetLabel: 'Novels', targetExists: true });
    expect(result).not.toHaveProperty('resourceLabel');
    expect(repository.findSnapshotLabels).toHaveBeenCalledWith([]);
  });

  it('falls back to the row snapshot, then to the newest snapshot for the same target', async () => {
    const { service, repository } = makeService({}, { 'library:88': 'KOReader Read-along Validation' });

    const [own, borrowed] = await service.attach([
      row({ id: 2, resourceLabel: 'Snapshot on this row' }),
      row({ id: 3, action: AuditAction.LibraryDelete }),
    ] as never);

    expect(own).toMatchObject({ targetLabel: 'Snapshot on this row', targetExists: false });
    expect(borrowed).toMatchObject({ targetLabel: 'KOReader Read-along Validation', targetExists: false });
    expect(repository.findLiveLabels).toHaveBeenCalledWith([
      { resource: AuditResource.Library, resourceId: 88 },
      { resource: AuditResource.User, resourceId: 1 },
    ]);
    expect(repository.findSnapshotLabels).toHaveBeenCalledWith([{ resource: AuditResource.Library, resourceId: 88 }]);
  });

  it('leaves targets with nothing to look up alone', async () => {
    const { service, repository } = makeService();

    const [settings, signIn] = await service.attach([
      row({ resource: AuditResource.AppSettings, resourceId: null, resourceLabel: null, userId: null, actorUsername: 'system' }),
      row({ action: AuditAction.AuthLogin, resource: null, resourceId: null, userId: null, actorUsername: 'livetest' }),
    ] as never);

    expect(settings).toMatchObject({ actorName: null, targetLabel: null, targetExists: null });
    expect(signIn).toMatchObject({ actorName: null, targetLabel: null, targetExists: null });
    expect(repository.findLiveLabels).toHaveBeenCalledWith([]);
    expect(repository.findSnapshotLabels).toHaveBeenCalledWith([]);
  });

  it('records no name when the lookup fails rather than failing the write', async () => {
    const { service, repository } = makeService();
    repository.findLiveLabels.mockRejectedValueOnce(new Error('connection reset'));
    const warn = vi.spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation(() => undefined);

    await expect(service.resolveForWrite(AuditResource.Library, 88)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[audit.target_label] [fail]'));
  });

  it('names people, leaving out accounts that no longer exist', async () => {
    const { service } = makeService({ 'user:1': 'Neon' });

    const names = await service.actorNames([1, 41, null, 1]);

    expect([...names]).toEqual([[1, 'Neon']]);
  });

  it('skips the lookup for target types without names', async () => {
    const { service, repository } = makeService();

    await expect(service.resolveForWrite(AuditResource.AppSettings, 1)).resolves.toBeNull();
    await expect(service.resolveForWrite(AuditResource.Library, undefined)).resolves.toBeNull();
    expect(repository.findLiveLabels).not.toHaveBeenCalled();
  });
});
