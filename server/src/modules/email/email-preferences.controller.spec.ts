import type { RequestUser } from '../../common/types/request-user';
import { EmailPreferencesController } from './email-preferences.controller';
import type { UpdateEmailPreferencesDto } from './dto/update-email-preferences.dto';
import { EmailPreferencesService } from './email-preferences.service';

describe('EmailPreferencesController', () => {
  const user: RequestUser = {
    id: 7,
    username: 'reader',
    name: 'Reader',
    email: 'reader@example.com',
    active: true,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'manual',
    roles: [],
  };

  it('delegates findForUser with current user', async () => {
    const expected = { userId: 7, defaultProviderId: 12, defaultRecipientId: null, defaultTemplateId: null };
    const service = { findForUser: jest.fn().mockResolvedValue(expected) } as unknown as EmailPreferencesService;
    const controller = new EmailPreferencesController(service);

    await expect(controller.findForUser(user)).resolves.toEqual(expected);
    expect(service.findForUser).toHaveBeenCalledWith(user);
  });

  it('delegates upsert with dto and current user', async () => {
    const dto: UpdateEmailPreferencesDto = { defaultRecipientId: 5 };
    const expected = { userId: 7, defaultRecipientId: 5 };
    const service = { upsert: jest.fn().mockResolvedValue(expected) } as unknown as EmailPreferencesService;
    const controller = new EmailPreferencesController(service);

    await expect(controller.upsert(dto, user)).resolves.toEqual(expected);
    expect(service.upsert).toHaveBeenCalledWith(dto, user);
  });
});
