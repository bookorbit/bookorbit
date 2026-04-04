import { describe, expect, it, vi } from 'vitest';

import { BookloreSourceAdapter } from './booklore-source.adapter';

describe('BookloreSourceAdapter shelf export', () => {
  it('carries the shelf owner through each shelf-book mapping', async () => {
    const connector = {
      listColumns: vi
        .fn()
        .mockResolvedValueOnce(new Set(['id', 'user_id', 'name']))
        .mockResolvedValueOnce(new Set(['shelf_id', 'book_id']))
        .mockResolvedValueOnce(new Set(['id'])),
      queryRows: vi
        .fn()
        .mockResolvedValueOnce([{ sourceShelfId: 's1', sourceUserId: 'u1', name: 'Favorites' }])
        .mockResolvedValueOnce([{ sourceShelfId: 's1', sourceUserId: 'u1', sourceBookId: 'b1' }]),
    };

    const adapter = new BookloreSourceAdapter(connector as never);

    const result = await (adapter as any).fetchShelves({} as never, 'shelf', 'book_shelf_mapping', 'book');

    expect(result).toEqual({
      shelves: [{ sourceShelfId: 's1', sourceUserId: 'u1', name: 'Favorites' }],
      shelfBooks: [{ sourceShelfId: 's1', sourceUserId: 'u1', sourceBookId: 'b1' }],
    });
    expect(connector.queryRows).toHaveBeenNthCalledWith(2, expect.anything(), expect.stringContaining('JOIN `shelf` s ON s.`id` = m.`shelf_id`'));
  });
});
