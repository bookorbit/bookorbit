import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { INDEXER_COLORS } from '@bookorbit/types';
import type { IndexerCategoryMap, IndexerColor } from '@bookorbit/types';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import {
  requestIndexerManagers,
  requestIndexers,
  type NewRequestIndexerManagerRow,
  type NewRequestIndexerRow,
  type RequestIndexerManagerRow,
  type RequestIndexerRow,
} from '../../../db/schema';
import type { ProwlarrIndexer } from './prowlarr.client';

type Db = NodePgDatabase<typeof schema>;

export interface IndexerManagerWithSources {
  manager: RequestIndexerManagerRow;
  sources: RequestIndexerRow[];
}

@Injectable()
export class IndexerManagerRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findAll(): Promise<IndexerManagerWithSources[]> {
    const managers = await this.db.select().from(requestIndexerManagers).orderBy(asc(requestIndexerManagers.id));
    if (managers.length === 0) return [];
    const sources = await this.db
      .select()
      .from(requestIndexers)
      .where(
        inArray(
          requestIndexers.managerId,
          managers.map((manager) => manager.id),
        ),
      )
      .orderBy(asc(requestIndexers.id));
    return managers.map((manager) => ({ manager, sources: sources.filter((source) => source.managerId === manager.id) }));
  }

  async findById(id: number): Promise<IndexerManagerWithSources | undefined> {
    const [manager] = await this.db.select().from(requestIndexerManagers).where(eq(requestIndexerManagers.id, id)).limit(1);
    if (!manager) return undefined;
    const sources = await this.db.select().from(requestIndexers).where(eq(requestIndexers.managerId, id)).orderBy(asc(requestIndexers.id));
    return { manager, sources };
  }

  async findRowsByIds(ids: number[]): Promise<RequestIndexerManagerRow[]> {
    if (ids.length === 0) return [];
    return this.db.select().from(requestIndexerManagers).where(inArray(requestIndexerManagers.id, ids));
  }

  async create(data: NewRequestIndexerManagerRow): Promise<RequestIndexerManagerRow> {
    const [row] = await this.db.insert(requestIndexerManagers).values(data).returning();
    return row;
  }

  async update(id: number, data: Partial<NewRequestIndexerManagerRow>): Promise<RequestIndexerManagerRow | undefined> {
    const [row] = await this.db.update(requestIndexerManagers).set(data).where(eq(requestIndexerManagers.id, id)).returning();
    return row;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(requestIndexerManagers).where(eq(requestIndexerManagers.id, id));
  }

  async updateSource(
    managerId: number,
    sourceId: number,
    data: Pick<Partial<NewRequestIndexerRow>, 'enabled' | 'color'>,
  ): Promise<RequestIndexerRow | undefined> {
    const [row] = await this.db
      .update(requestIndexers)
      .set(data)
      .where(and(eq(requestIndexers.id, sourceId), eq(requestIndexers.managerId, managerId)))
      .returning();
    return row;
  }

  async setSourcesAvailable(managerId: number, available: boolean): Promise<void> {
    await this.db.update(requestIndexers).set({ managerAvailable: available }).where(eq(requestIndexers.managerId, managerId));
  }

  async recordTestResult(id: number, ok: boolean, error: string | null, version: string | null): Promise<void> {
    await this.db
      .update(requestIndexerManagers)
      .set({ lastTestedAt: new Date(), lastTestOk: ok, lastErrorMessage: error, ...(version ? { version } : {}) })
      .where(eq(requestIndexerManagers.id, id));
  }

  async recordSyncFailure(id: number, error: string): Promise<void> {
    await this.db
      .update(requestIndexerManagers)
      .set({ lastSyncedAt: new Date(), lastSyncOk: false, lastSyncError: error })
      .where(eq(requestIndexerManagers.id, id));
  }

  async syncProwlarrSources(
    manager: RequestIndexerManagerRow,
    discovered: ProwlarrIndexer[],
    categories: Record<'torrent' | 'usenet', IndexerCategoryMap>,
  ): Promise<{ created: number; updated: number; unavailable: number }> {
    return this.db.transaction(async (tx) => {
      const existing = await tx.select().from(requestIndexers).where(eq(requestIndexers.managerId, manager.id));
      const assignedColors = await tx.select({ color: requestIndexers.color }).from(requestIndexers);
      const colorCounts = new Map<IndexerColor, number>(INDEXER_COLORS.map((color) => [color, 0]));
      for (const { color } of assignedColors) {
        if (color) colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
      }
      const nextColor = () => {
        let selected: IndexerColor = INDEXER_COLORS[0];
        for (const color of INDEXER_COLORS) {
          if ((colorCounts.get(color) ?? 0) < (colorCounts.get(selected) ?? 0)) selected = color;
        }
        colorCounts.set(selected, (colorCounts.get(selected) ?? 0) + 1);
        return selected;
      };
      const byExternalId = new Map(existing.map((row) => [row.managerExternalId, row]));
      const seen = discovered.map((source) => String(source.id));
      let created = 0;
      let updated = 0;

      for (const source of discovered) {
        const externalId = String(source.id);
        const current = byExternalId.get(externalId);
        const adapterType = source.protocol === 'torrent' ? 'torznab' : 'newznab';
        const metadata = {
          displayName: source.name,
          implementation: source.implementation,
          protocol: source.protocol,
          priority: source.priority,
        } as const;
        const baseUrl = managedEndpoint(manager.baseUrl, source.id);

        if (current) {
          await tx
            .update(requestIndexers)
            .set({
              adapterType,
              baseUrl,
              color: current.color ?? nextColor(),
              managerAvailable: manager.enabled && source.enabled,
              managerLastSeenAt: new Date(),
              managerMetadata: metadata,
              allowPrivateAddress: manager.allowPrivateAddress,
              networkProfile: manager.networkProfile,
              categories: categories[source.protocol],
              seedRatioGoal: manager.inheritSeedLimits && source.protocol === 'torrent' ? source.seedRatioGoal : null,
              seedTimeMinutes: manager.inheritSeedLimits && source.protocol === 'torrent' ? source.seedTimeMinutes : null,
            })
            .where(eq(requestIndexers.id, current.id));
          updated++;
          continue;
        }

        await tx.insert(requestIndexers).values({
          name: `managed-${manager.id}-${externalId}`,
          color: nextColor(),
          adapterType,
          managerId: manager.id,
          managerExternalId: externalId,
          managerAvailable: manager.enabled && source.enabled,
          managerLastSeenAt: new Date(),
          managerMetadata: metadata,
          enabled: manager.syncNewIndexers,
          baseUrl,
          credentialsEnc: null,
          allowPrivateAddress: manager.allowPrivateAddress,
          applyTrackerSeedGoals: true,
          seedRatioGoal: manager.inheritSeedLimits && source.protocol === 'torrent' ? source.seedRatioGoal : null,
          seedTimeMinutes: manager.inheritSeedLimits && source.protocol === 'torrent' ? source.seedTimeMinutes : null,
          categories: categories[source.protocol],
          disabledMediaKinds: [],
          isbnSearchDisabled: adapterType === 'torznab',
          settings: null,
          networkProfile: manager.networkProfile,
        });
        created++;
      }

      let unavailable = 0;
      if (existing.length > 0) {
        const missing = seen.length === 0 ? existing : existing.filter((row) => !seen.includes(row.managerExternalId ?? ''));
        if (missing.length > 0) {
          await tx
            .update(requestIndexers)
            .set({ managerAvailable: false })
            .where(
              inArray(
                requestIndexers.id,
                missing.map((row) => row.id),
              ),
            );
          unavailable = missing.length;
        }
      }

      await tx
        .update(requestIndexerManagers)
        .set({ lastSyncedAt: new Date(), lastSyncOk: true, lastSyncError: null })
        .where(eq(requestIndexerManagers.id, manager.id));
      return { created, updated, unavailable };
    });
  }
}

function managedEndpoint(baseUrl: string, sourceId: number): string {
  const base = new URL(baseUrl);
  const prefix = base.pathname.replace(/\/+$/, '');
  base.pathname = `${prefix}/api/v1/indexer/${sourceId}/newznab`;
  base.search = '';
  base.hash = '';
  return base.href.replace(/\/$/, '');
}
