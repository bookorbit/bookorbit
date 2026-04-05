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

describe('BookloreSourceAdapter table resolution', () => {
  it('uses the resolved library path table when fetching path prefixes', async () => {
    const connector = {
      withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
      listTables: vi.fn().mockResolvedValue(new Set(['library_path'])),
      queryRows: vi.fn().mockResolvedValue([{ path: '/books' }]),
    };

    const adapter = new BookloreSourceAdapter(connector as never);

    const result = await adapter.fetchPathPrefixes({} as never);

    expect(result).toEqual(['/books']);
    expect(connector.queryRows).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('FROM `library_path`'));
  });

  it('does not resolve guessed plural table names that are absent from Booklore', async () => {
    const connector = {
      withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
      listTables: vi.fn().mockResolvedValue(new Set(['library_paths'])),
      queryRows: vi.fn(),
    };

    const adapter = new BookloreSourceAdapter(connector as never);

    const result = await adapter.fetchPathPrefixes({} as never);

    expect(result).toEqual([]);
    expect(connector.queryRows).not.toHaveBeenCalled();
  });

  it('detects ebook viewer preferences from the live Booklore table name', async () => {
    const connector = {
      withConnection: vi.fn().mockImplementation((_config, fn) => fn({})),
      listTables: vi.fn().mockResolvedValue(new Set(['users', 'book', 'book_file', 'epub_viewer_preference', 'ebook_viewer_preference'])),
      countRows: vi.fn().mockResolvedValue(1),
      queryRows: vi.fn().mockResolvedValue([{ version: '11.4.5' }]),
    };

    const adapter = new BookloreSourceAdapter(connector as never);

    const result = await adapter.validate({
      host: 'localhost',
      port: 3306,
      user: 'booklore',
      password: 'secret',
      database: 'booklore',
      mediaRootPath: '/books',
      ssl: false,
    });

    expect(result.warnings).toContain('Booklore viewer preference tables detected; reader preference migration is deferred');
    expect(connector.countRows).toHaveBeenCalledWith(expect.anything(), 'epub_viewer_preference');
    expect(connector.countRows).toHaveBeenCalledWith(expect.anything(), 'ebook_viewer_preference');
  });
});
