import { BrowseCountsService } from './browse-counts.service';

function reqUser(id = 7) {
  return { id, isSuperuser: false, permissions: [], contentFilters: undefined } as never;
}

function makeService() {
  const authorsService = { countAll: vi.fn().mockResolvedValue(1234) };
  const seriesService = { countAll: vi.fn().mockResolvedValue(312) };
  const annotationHubService = { countActive: vi.fn().mockResolvedValue(18000) };
  const taxonomyService = { countVisible: vi.fn().mockResolvedValue(87) };
  const service = new BrowseCountsService(authorsService as never, seriesService as never, annotationHubService as never, taxonomyService as never);
  return { service, authorsService, seriesService, annotationHubService, taxonomyService };
}

describe('BrowseCountsService', () => {
  it('returns the browse totals for the user', async () => {
    const { service, annotationHubService, taxonomyService } = makeService();

    await expect(service.getCounts(reqUser())).resolves.toEqual({ authors: 1234, series: 312, annotations: 18000, genres: 87 });
    expect(annotationHubService.countActive).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
    expect(taxonomyService.countVisible).toHaveBeenCalledWith('genre', expect.objectContaining({ id: 7 }));
  });

  it('serves repeat requests from the cache instead of re-querying', async () => {
    const { service, authorsService, seriesService, annotationHubService } = makeService();

    await service.getCounts(reqUser());
    await service.getCounts(reqUser());

    expect(authorsService.countAll).toHaveBeenCalledTimes(1);
    expect(seriesService.countAll).toHaveBeenCalledTimes(1);
    expect(annotationHubService.countActive).toHaveBeenCalledTimes(1);
  });

  it('caches per user so one user never sees the totals of another', async () => {
    const { service, authorsService } = makeService();
    authorsService.countAll.mockResolvedValueOnce(10).mockResolvedValueOnce(20);

    const first = await service.getCounts(reqUser(1));
    const second = await service.getCounts(reqUser(2));

    expect(first.authors).toBe(10);
    expect(second.authors).toBe(20);
  });
});
