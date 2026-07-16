import { BookDockProcessingStateService } from './book-dock-processing-state.service';

function makeService() {
  const appSettings = {
    isBookDockPaused: vi.fn().mockResolvedValue(false),
    setBookDockPaused: vi.fn().mockResolvedValue(undefined),
  };
  const service = new BookDockProcessingStateService(appSettings as never);
  return { service, appSettings };
}

describe('BookDockProcessingStateService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads persisted paused state once and exposes a cached value', async () => {
    const { service, appSettings } = makeService();
    appSettings.isBookDockPaused.mockResolvedValue(true);

    await expect(service.isPaused()).resolves.toBe(true);
    await expect(service.isPaused()).resolves.toBe(true);

    expect(appSettings.isBookDockPaused).toHaveBeenCalledTimes(1);
    expect(service.getCachedPaused()).toBe(true);
  });

  it('persists pause and resume updates', async () => {
    const { service, appSettings } = makeService();

    await service.pause();
    expect(service.getCachedPaused()).toBe(true);
    expect(appSettings.setBookDockPaused).toHaveBeenCalledWith(true);

    await service.resume();
    expect(service.getCachedPaused()).toBe(false);
    expect(appSettings.setBookDockPaused).toHaveBeenCalledWith(false);
  });
});
