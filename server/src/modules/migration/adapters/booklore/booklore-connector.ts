import { BadRequestException, Injectable } from '@nestjs/common';
import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';

import type { BookloreConnectionConfig } from './booklore-connection-config';
import { isBookloreMigrationTableName } from './booklore-tables';

type Row = RowDataPacket & Record<string, unknown>;

const CONNECT_TIMEOUT_MS = 10_000;

@Injectable()
export class BookloreConnector {
  async withConnection<T>(config: BookloreConnectionConfig, fn: (conn: mysql.Connection) => Promise<T>): Promise<T> {
    let connection: mysql.Connection;
    try {
      connection = await mysql.createConnection({
        host: config.host,
        port: config.port ?? 3306,
        user: config.user,
        password: config.password,
        database: config.database,
        ssl: config.ssl ? {} : undefined,
        supportBigNumbers: true,
        connectTimeout: CONNECT_TIMEOUT_MS,
      });
    } catch (error) {
      throw toSourceConnectionException(error);
    }

    try {
      try {
        return await fn(connection);
      } catch (error) {
        throw toSourceConnectionException(error);
      }
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
    if (!isBookloreMigrationTableName(tableName)) {
      throw new Error(`Table "${tableName}" is not in the allowed migration table list`);
    }
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

function toSourceConnectionException(error: unknown): unknown {
  if (error instanceof BadRequestException) return error;

  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const code = asErrorCode(error);
  const normalizedMessage = message.toLowerCase();

  if (code === 'ER_ACCESS_DENIED_ERROR' || normalizedMessage.includes('access denied') || normalizedMessage.includes('authentication failed')) {
    return new BadRequestException('Authentication failed. Check the username and password.');
  }

  if (code === 'ER_BAD_DB_ERROR' || normalizedMessage.includes('unknown database')) {
    return new BadRequestException('Database not found. Check the database name.');
  }

  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    code === 'EAI_AGAIN' ||
    normalizedMessage.includes('econnrefused') ||
    normalizedMessage.includes('enotfound') ||
    normalizedMessage.includes('ehostunreach')
  ) {
    return new BadRequestException('Could not reach the database server. Check the host and port.');
  }

  if (
    code === 'ETIMEDOUT' ||
    code === 'PROTOCOL_SEQUENCE_TIMEOUT' ||
    normalizedMessage.includes('etimedout') ||
    normalizedMessage.includes('timed out') ||
    normalizedMessage.includes('timeout')
  ) {
    return new BadRequestException('Connection timed out. Check host and firewall settings.');
  }

  if (
    code === 'HANDSHAKE_SSL_ERROR' ||
    normalizedMessage.includes('ssl') ||
    normalizedMessage.includes('tls') ||
    normalizedMessage.includes('certificate')
  ) {
    return new BadRequestException('SSL/TLS connection failed. Check TLS/SSL settings and certificates.');
  }

  return error;
}

function asErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string' || code.trim().length === 0) return null;
  return code.trim().toUpperCase();
}
