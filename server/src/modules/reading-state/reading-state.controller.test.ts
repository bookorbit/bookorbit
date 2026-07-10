import { EMPTY_CONTENT_FILTER_RULES, AuditAction, AuditResource, Permission } from '@bookorbit/types';

import { AUDITABLE_KEY } from '../../common/decorators/auditable.decorator';
import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { ReadingStateController } from './reading-state.controller';
import { ReadingStateService } from './reading-state.service';

const user: RequestUser = {
  id: 8,
  username: 'reader',
  name: 'Reader',
  email: null,
  active: true,
  isSuperuser: false,
  isDefaultPassword: false,
  tokenVersion: 1,
  settings: {},
  avatarUrl: null,
  provisioningMethod: 'local',
  permissions: [],
  contentFilters: EMPTY_CONTENT_FILTER_RULES,
};

function makeController() {
  const service = {
    resetBookReadingState: vi.fn(),
  };

  return {
    controller: new ReadingStateController(service as unknown as ReadingStateService),
    service,
  };
}

describe('ReadingStateController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates the reset action with the parsed book id and current user', async () => {
    const { controller, service } = makeController();
    const expected = {
      readStatus: {
        status: 'unread',
        source: 'manual',
        startedAt: null,
        finishedAt: null,
        updatedAt: '2026-07-09T12:00:00.000Z',
      },
    };
    service.resetBookReadingState.mockResolvedValue(expected);

    await expect(controller.resetBookReadingState(42, user)).resolves.toEqual(expected);
    expect(service.resetBookReadingState).toHaveBeenCalledWith(42, user);
  });

  it('requires metadata-edit permission and defines the expected book audit event', () => {
    const method = ReadingStateController.prototype.resetBookReadingState;
    const permission = Reflect.getMetadata(PERMISSION_KEY, method);
    const audit = Reflect.getMetadata(AUDITABLE_KEY, method) as {
      action: AuditAction;
      resource: AuditResource;
      getResourceId: (request: { params: Record<string, string> }, response: unknown) => number | undefined;
      description: (request: { params: Record<string, string> }, response: unknown) => string;
    };

    expect(permission).toBe(Permission.LibraryEditMetadata);
    expect(audit).toMatchObject({ action: AuditAction.BookReadingStateReset, resource: AuditResource.Book });
    expect(audit.getResourceId({ params: { bookId: '42' } }, null)).toBe(42);
    expect(audit.description({ params: { bookId: '42' } }, null)).toBe('Reset reading state for book #42');
  });
});
