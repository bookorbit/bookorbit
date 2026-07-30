import { BrowseCountsController } from './browse-counts.controller';

describe('BrowseCountsController', () => {
  it('passes the current user through to the service', async () => {
    const counts = { authors: 1234, series: 312, annotations: 18000 };
    const service = { getCounts: vi.fn().mockResolvedValue(counts) };
    const controller = new BrowseCountsController(service as never);
    const user = { id: 7, isSuperuser: false, permissions: [], contentFilters: undefined } as never;

    await expect(controller.getCounts(user)).resolves.toEqual(counts);
    expect(service.getCounts).toHaveBeenCalledWith(user);
  });
});
