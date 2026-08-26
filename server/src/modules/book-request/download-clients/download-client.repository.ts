import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { DownloadClientType } from '@bookorbit/types';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import {
  downloadClientPathMappings,
  downloadClients,
  type DownloadClientPathMappingRow,
  type DownloadClientRow,
  type NewDownloadClientRow,
} from '../../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface DownloadClientWithMappings {
  client: DownloadClientRow;
  pathMappings: DownloadClientPathMappingRow[];
}

@Injectable()
export class DownloadClientRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findAll(): Promise<DownloadClientWithMappings[]> {
    const clients = await this.db.select().from(downloadClients).orderBy(asc(downloadClients.priority), asc(downloadClients.id));
    return this.attachMappings(clients);
  }

  async findById(id: number): Promise<DownloadClientWithMappings | undefined> {
    const [client] = await this.db.select().from(downloadClients).where(eq(downloadClients.id, id)).limit(1);
    if (!client) return undefined;
    const [withMappings] = await this.attachMappings([client]);
    return withMappings;
  }

  /** Every enabled client in pick order, for the approver-facing summary list. */
  async findAllEnabled(): Promise<DownloadClientRow[]> {
    return this.db
      .select()
      .from(downloadClients)
      .where(eq(downloadClients.enabled, true))
      .orderBy(asc(downloadClients.priority), asc(downloadClients.id));
  }

  /**
   * The grab path's default when the approver does not name a client. Narrowed by adapter type,
   * because a client that cannot carry out this kind of grab is not a candidate at any priority.
   */
  async findPreferredEnabled(adapterTypes: readonly DownloadClientType[]): Promise<DownloadClientRow | undefined> {
    if (adapterTypes.length === 0) return undefined;
    const [row] = await this.db
      .select()
      .from(downloadClients)
      .where(and(eq(downloadClients.enabled, true), inArray(downloadClients.adapterType, [...adapterTypes])))
      .orderBy(asc(downloadClients.priority), asc(downloadClients.id))
      .limit(1);
    return row;
  }

  /**
   * The client and the mappings it may import from, written together.
   *
   * Separately, a mapping insert that fails leaves a saved client with no mapping at all, which
   * every import then refuses; the operator sees a client that exists, looks configured, and
   * cannot be re-created because the name is already taken.
   */
  async createWithPathMappings(data: NewDownloadClientRow, mappings: Array<{ remotePath: string; localPath: string }>): Promise<DownloadClientRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(downloadClients).values(data).returning();
      if (mappings.length > 0) {
        await tx.insert(downloadClientPathMappings).values(mappings.map((mapping) => ({ ...mapping, downloadClientId: row.id })));
      }
      return row;
    });
  }

  async update(id: number, data: Partial<NewDownloadClientRow>): Promise<DownloadClientRow | undefined> {
    const [row] = await this.db.update(downloadClients).set(data).where(eq(downloadClients.id, id)).returning();
    return row;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(downloadClients).where(eq(downloadClients.id, id));
  }

  async recordTestResult(id: number, ok: boolean, errorMessage: string | null): Promise<void> {
    await this.db
      .update(downloadClients)
      .set({ lastTestedAt: new Date(), lastTestOk: ok, lastErrorMessage: errorMessage })
      .where(eq(downloadClients.id, id));
  }

  /**
   * Mappings are replaced wholesale inside one transaction, so a half-applied edit can never
   * leave a client translating some paths with the old set and some with the new.
   */
  async replacePathMappings(clientId: number, mappings: Array<{ remotePath: string; localPath: string }>): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(downloadClientPathMappings).where(eq(downloadClientPathMappings.downloadClientId, clientId));
      if (mappings.length === 0) return;
      await tx.insert(downloadClientPathMappings).values(mappings.map((mapping) => ({ ...mapping, downloadClientId: clientId })));
    });
  }

  async findPathMappings(clientId: number): Promise<DownloadClientPathMappingRow[]> {
    return (
      this.db
        .select()
        .from(downloadClientPathMappings)
        .where(eq(downloadClientPathMappings.downloadClientId, clientId))
        // Longest prefix first, so the caller can take the first match rather than scanning.
        .orderBy(sql`length(${downloadClientPathMappings.remotePath}) desc`)
    );
  }

  private async attachMappings(clients: DownloadClientRow[]): Promise<DownloadClientWithMappings[]> {
    if (clients.length === 0) return [];
    const rows = await this.db
      .select()
      .from(downloadClientPathMappings)
      .where(
        inArray(
          downloadClientPathMappings.downloadClientId,
          clients.map((client) => client.id),
        ),
      )
      .orderBy(asc(downloadClientPathMappings.id));

    const byClient = new Map<number, DownloadClientPathMappingRow[]>();
    for (const row of rows) {
      const bucket = byClient.get(row.downloadClientId) ?? [];
      bucket.push(row);
      byClient.set(row.downloadClientId, bucket);
    }

    return clients.map((client) => ({ client, pathMappings: byClient.get(client.id) ?? [] }));
  }
}
