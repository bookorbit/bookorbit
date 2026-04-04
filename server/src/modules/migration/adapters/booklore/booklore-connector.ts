import { Injectable } from '@nestjs/common';
import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';

import type { BookloreConnectionConfig } from './booklore-connection-config';

type Row = RowDataPacket & Record<string, unknown>;

@Injectable()
export class BookloreConnector {
  async withConnection<T>(config: BookloreConnectionConfig, fn: (conn: mysql.Connection) => Promise<T>): Promise<T> {
    const connection = await mysql.createConnection({
      host: config.host,
      port: config.port ?? 3306,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl ? {} : undefined,
      supportBigNumbers: true,
    });

    try {
      return await fn(connection);
    } finally {
      await connection.end();
    }
  }

  async listTables(conn: mysql.Connection): Promise<Set<string>> {
    const [rows] = await conn.query<Row[]>(
      `
      SELECT table_name AS tableName
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
      `,
    );

    return new Set(rows.map((row) => String(row.tableName).toLowerCase()));
  }

  async listColumns(conn: mysql.Connection, tableName: string): Promise<Set<string>> {
    const [rows] = await conn.query<Row[]>(
      `
      SELECT column_name AS columnName
      FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?
      `,
      [tableName],
    );

    return new Set(rows.map((row) => String(row.columnName).toLowerCase()));
  }

  async countRows(conn: mysql.Connection, tableName: string): Promise<number> {
    const [rows] = await conn.query<Row[]>(`SELECT COUNT(*) AS count FROM \`${tableName}\``);
    const value = rows[0]?.count;
    const count = typeof value === 'number' ? value : Number(value ?? 0);
    return Number.isFinite(count) ? count : 0;
  }

  async queryRows(conn: mysql.Connection, sqlText: string, params: unknown[] = []): Promise<Row[]> {
    const [rows] = await conn.query<Row[]>(sqlText, params);
    return rows;
  }
}
