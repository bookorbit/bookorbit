import type { RequestUser } from '../../common/types/request-user';
import { EmailSendLogController } from './email-send-log.controller';
import { EmailSendLogService } from './email-send-log.service';
import type { QuerySendLogDto } from './dto/query-send-log.dto';
import { EmailSendOrchestrator } from './email-send-orchestrator.service';

describe('EmailSendLogController', () => {
  const user: RequestUser = {
    id: 11,
    username: 'sender',
    name: 'Sender',
    email: 'sender@example.com',
    active: true,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'manual',
    roles: [],
  };

  const logService = {
    findForUser: jest.fn(),
    remove: jest.fn(),
  } as unknown as EmailSendLogService;

  const orchestrator = {
    resend: jest.fn(),
  } as unknown as EmailSendOrchestrator;

  const controller = new EmailSendLogController(logService, orchestrator);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses default pagination values when query is empty', async () => {
    await controller.findForUser({} as QuerySendLogDto, user);
    expect(logService.findForUser).toHaveBeenCalledWith(user, 0, 20);
  });

  it('forwards explicit pagination values', async () => {
    await controller.findForUser({ page: 4, size: 5 }, user);
    expect(logService.findForUser).toHaveBeenCalledWith(user, 4, 5);
  });

  it('delegates remove', async () => {
    await controller.remove(88, user);
    expect(logService.remove).toHaveBeenCalledWith(88, user);
  });

  it('delegates resend', async () => {
    await controller.resend(88, user);
    expect(orchestrator.resend).toHaveBeenCalledWith(88, user);
  });
});
