import { ReadingSessionController } from './reading-session.controller';

describe('ReadingSessionController', () => {
  it('delegates saveSession to ReadingSessionService', async () => {
    const service = {
      save: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new ReadingSessionController(service as never);
    const user = { id: 17 } as never;
    const dto = {
      sessionId: 'session-1',
      startedAt: '2026-04-15T10:00:00.000Z',
      endedAt: '2026-04-15T10:05:00.000Z',
      durationSeconds: 300,
      progressDelta: 1.2,
      endProgress: 44,
    };

    await controller.saveSession(42, dto, user);

    expect(service.save).toHaveBeenCalledWith(42, dto, user);
  });
});
