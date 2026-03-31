import { MetadataRecalculationTrigger, type MetadataRecalculationStatus } from './metadata-score.service';
import { MetadataScoreController } from './metadata-score.controller';

function runningStatus(trigger: MetadataRecalculationTrigger): MetadataRecalculationStatus {
  return {
    state: 'running',
    trigger,
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    endedAt: null,
    processed: 0,
    succeeded: 0,
    failed: 0,
    error: null,
  };
}

describe('MetadataScoreController', () => {
  const service = {
    getWeights: vi.fn(),
    updateWeights: vi.fn(),
    requestRecalculation: vi.fn(),
    getRecalculationStatus: vi.fn(),
  };
  const controller = new MetadataScoreController(service as never);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns score weights', async () => {
    service.getWeights.mockResolvedValue({ title: 10 });

    await expect(controller.getWeights()).resolves.toEqual({ title: 10 });
  });

  it('updates score weights with DTO payload', async () => {
    const dto = {
      title: 10,
      subtitle: 0,
      description: 8,
      coverSource: 10,
      genres: 6,
      isbn13: 7,
      publisher: 4,
      publishedYear: 4,
      language: 4,
      isbn10: 2,
      pageCount: 2,
      rating: 1,
      seriesName: 0,
      seriesIndex: 0,
      tags: 2,
      authors: 10,
      googleBooksId: 1,
      goodreadsId: 1,
      amazonId: 1,
      hardcoverId: 1,
      openLibraryId: 1,
      itunesId: 1,
    };
    service.updateWeights.mockResolvedValue(dto);

    await expect(controller.updateWeights(dto)).resolves.toEqual(dto);
    expect(service.updateWeights).toHaveBeenCalledWith(dto);
  });

  it('accepts a new recalculation request', () => {
    const status = runningStatus(MetadataRecalculationTrigger.MANUAL);
    service.requestRecalculation.mockReturnValue({ started: true, status });

    expect(controller.recalculate()).toEqual({
      started: true,
      status,
      message: 'Recalculation started',
    });
    expect(service.requestRecalculation).toHaveBeenCalledWith(MetadataRecalculationTrigger.MANUAL);
  });

  it('returns already-running message when recalculation is in progress', () => {
    const status = runningStatus(MetadataRecalculationTrigger.WEIGHTS_UPDATE);
    service.requestRecalculation.mockReturnValue({ started: false, status });

    expect(controller.recalculate()).toEqual({
      started: false,
      status,
      message: 'Recalculation already running',
    });
  });

  it('returns recalculation status payload', () => {
    const status = {
      state: 'completed',
      trigger: MetadataRecalculationTrigger.MANUAL,
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      endedAt: new Date('2026-01-01T00:00:02.000Z'),
      processed: 200,
      succeeded: 199,
      failed: 1,
      error: null,
    } satisfies MetadataRecalculationStatus;
    service.getRecalculationStatus.mockReturnValue(status);

    expect(controller.getRecalculationStatus()).toEqual(status);
  });
});
