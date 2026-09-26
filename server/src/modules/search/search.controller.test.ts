import type { RequestUser } from '../../common/types/request-user';
import { SearchController } from './search.controller';

describe('SearchController', () => {
  it('delegates the validated query and current user', async () => {
    const service = { search: vi.fn().mockResolvedValue({ query: 'dune' }) };
    const controller = new SearchController(service as never);
    const user = { id: 7 } as RequestUser;
    const dto = { q: 'dune', limit: 5 };

    const result = await controller.search(dto, user);

    expect(service.search).toHaveBeenCalledWith(user, dto);
    expect(result).toEqual({ query: 'dune' });
  });
});
