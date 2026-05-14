vi.mock('mysql2/promise', () => {
  const createConnection = vi.fn();
  return {
    default: {
      createConnection,
    },
  };
});

import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import mysql from 'mysql2/promise';

import { BookloreConnector } from './booklore-connector';

describe('BookloreConnector', () => {
  it('opens a connection, runs callback, and always closes connection', async () => {
    const connector = new BookloreConnector();
    const end = vi.fn().mockResolvedValue(undefined);
    const connection = { end } as never;
    const createConnection = mysql.createConnection as unknown as ReturnType<typeof vi.fn>;
    createConnection.mockResolvedValue(connection);

    await expect(
      connector.withConnection({ host: 'localhost', user: 'root', password: '', database: 'booklore', ssl: false } as never, () =>
        Promise.resolve('ok'),
      ),
    ).resolves.toBe('ok');
    await expect(
      connector.withConnection({ host: 'localhost', user: 'root', password: '', database: 'booklore', ssl: false } as never, () =>
        Promise.reject(new Error('boom')),
      ),
    ).rejects.toThrow('boom');

    expect(createConnection).toHaveBeenCalledTimes(2);
    expect(end).toHaveBeenCalledTimes(2);
  });

  it('lists tables and columns as lowercase names', async () => {
    const connector = new BookloreConnector();
    const conn = {
      query: vi
        .fn()
        .mockResolvedValueOnce([[{ tableName: 'Book' }, { tableName: 'BOOK_FILE' }]])
        .mockResolvedValueOnce([[{ columnName: 'ID' }, { columnName: 'Book_ID' }]]),
    };

    await expect(connector.listTables(conn as never)).resolves.toEqual(new Set(['book', 'book_file']));
    await expect(connector.listColumns(conn as never, 'book_file')).resolves.toEqual(new Set(['id', 'book_id']));
    expect(conn.query).toHaveBeenLastCalledWith(
      `
      SELECT column_name AS columnName
      FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?
      `,
      ['book_file'],
    );
  });

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

  it('normalizes non-numeric count values and proxies raw query rows', async () => {
    const connector = new BookloreConnector();
    const conn = {
      query: vi
        .fn()
        .mockResolvedValueOnce([[{ count: '7' }]])
        .mockResolvedValueOnce([[{ count: 'not-a-number' }]])
        .mockResolvedValueOnce([[{ id: 1 }]]),
    };

    await expect(connector.countRows(conn as never, 'book_file')).resolves.toBe(7);
    await expect(connector.countRows(conn as never, 'book_file')).resolves.toBe(0);
    await expect(connector.queryRows(conn as never, 'SELECT * FROM book WHERE id = ?', [1])).resolves.toEqual([{ id: 1 }]);
  });

  it('maps access denied connection failures to a user-facing BadRequestException', async () => {
    const connector = new BookloreConnector();
    const createConnection = mysql.createConnection as unknown as ReturnType<typeof vi.fn>;
    createConnection.mockRejectedValue(Object.assign(new Error("Access denied for user 'booklore'"), { code: 'ER_ACCESS_DENIED_ERROR' }));

    let thrown: unknown;
    try {
      await connector.withConnection({ host: 'localhost', user: 'booklore', password: 'pw', database: 'booklore', ssl: false } as never, () =>
        Promise.resolve('ok'),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BadRequestException);
    const payload = (thrown as BadRequestException).getResponse() as { message?: string };
    expect(payload.message).toBe('Authentication failed. Check the username and password.');
  });
});
