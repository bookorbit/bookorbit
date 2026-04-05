import { describe, expect, it, vi } from 'vitest';

import { BookloreConnector } from './booklore-connector';

describe('BookloreConnector', () => {
  it('counts live Booklore migration tables', async () => {
    const connector = new BookloreConnector();
    const conn = {
      query: vi.fn().mockResolvedValue([[{ count: 12 }]]),
    };

    await expect(connector.countRows(conn as never, 'book_file')).resolves.toBe(12);
    expect(conn.query).toHaveBeenCalledWith('SELECT COUNT(*) AS count FROM `book_file`');
  });

  it('rejects guessed plural table names that are not in the live Booklore schema', async () => {
    const connector = new BookloreConnector();
    const conn = {
      query: vi.fn(),
    };

    await expect(connector.countRows(conn as never, 'book_files')).rejects.toThrow('allowed migration table list');
    expect(conn.query).not.toHaveBeenCalled();
  });
});
