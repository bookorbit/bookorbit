import type { RequestUser } from '../../common/types/request-user';
import { EmailSendController } from './email-send.controller';
import type { SendBookDto } from './dto/send-book.dto';
import { EmailSendOrchestrator } from './email-send-orchestrator.service';

describe('EmailSendController', () => {
  const user: RequestUser = {
    id: 8,
    username: 'sender8',
    name: 'Sender Eight',
    email: 'sender8@example.com',
    active: true,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'manual',
    roles: [],
  };

  const orchestrator = {
    send: jest.fn(),
    quickSend: jest.fn(),
  } as unknown as EmailSendOrchestrator;

  const controller = new EmailSendController(orchestrator);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates send with dto and user', async () => {
    const dto: SendBookDto = { bookIds: [1, 2], recipientIds: [3], groupIds: [4], providerId: 5, templateId: 6, fileId: 7 };

    await controller.send(dto, user);

    expect(orchestrator.send).toHaveBeenCalledWith(dto, user);
  });

  it('delegates quickSend with book id and user', async () => {
    await controller.quickSend(99, user);

    expect(orchestrator.quickSend).toHaveBeenCalledWith(99, user);
  });
});
