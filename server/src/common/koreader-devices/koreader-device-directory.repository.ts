import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';
import {
  bookFileHashHistory,
  bookFiles,
  koreaderBookHashLinks,
  koreaderDeviceNames,
  koreaderDeviceProgress,
  koreaderDeviceSettings,
  koreaderDeviceSweeps,
  koreaderPageStats,
} from '../../db/schema';

export interface KoreaderDeviceRow {
  deviceId: string;
  model: string;
}

@Injectable()
export class KoreaderDeviceDirectoryRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  /** Every device that uploaded page events for these files, which is every device a derived session on them can come from. */
  async findPageStatDevices(userId: number, bookFileIds: readonly number[]): Promise<{ bookFileId: number; deviceId: string }[]> {
    if (bookFileIds.length === 0) return [];
    return this.db
      .selectDistinct({ bookFileId: koreaderPageStats.bookFileId, deviceId: koreaderPageStats.deviceId })
      .from(koreaderPageStats)
      .where(and(eq(koreaderPageStats.userId, userId), inArray(koreaderPageStats.bookFileId, [...bookFileIds])));
  }

  async findNames(userId: number, deviceIds: readonly string[]): Promise<Map<string, string>> {
    if (deviceIds.length === 0) return new Map();
    const rows = await this.db
      .select({ deviceId: koreaderDeviceNames.deviceId, name: koreaderDeviceNames.name })
      .from(koreaderDeviceNames)
      .where(and(eq(koreaderDeviceNames.userId, userId), inArray(koreaderDeviceNames.deviceId, [...deviceIds])));
    return new Map(rows.map((row) => [row.deviceId, row.name]));
  }

  /** The model each device last reported with its reading progress, which is what the device settings list. */
  async findProgressModels(userId: number, deviceIds: readonly string[]): Promise<KoreaderDeviceRow[]> {
    if (deviceIds.length === 0) return [];
    return this.db
      .selectDistinctOn([koreaderDeviceProgress.deviceId], { deviceId: koreaderDeviceProgress.deviceId, model: koreaderDeviceProgress.device })
      .from(koreaderDeviceProgress)
      .where(
        and(
          eq(koreaderDeviceProgress.userId, userId),
          inArray(koreaderDeviceProgress.deviceId, [...deviceIds]),
          eq(koreaderDeviceProgress.orphaned, false),
        ),
      )
      .orderBy(koreaderDeviceProgress.deviceId, desc(koreaderDeviceProgress.updatedAt));
  }

  /** The model each device reported on its last plugin sweep, for devices that never sent progress. */
  async findSweepModels(userId: number, deviceIds: readonly string[]): Promise<KoreaderDeviceRow[]> {
    if (deviceIds.length === 0) return [];
    return this.db
      .select({ deviceId: koreaderDeviceSweeps.deviceId, model: koreaderDeviceSweeps.deviceModel })
      .from(koreaderDeviceSweeps)
      .where(and(eq(koreaderDeviceSweeps.userId, userId), inArray(koreaderDeviceSweeps.deviceId, [...deviceIds])));
  }

  /** Every device the user's KOReader setup records, apart from page stats, which are too many to scan per request. */
  async findKnownDeviceIds(userId: number): Promise<string[]> {
    const [sweeps, progress, settings, names] = await Promise.all([
      this.db.select({ deviceId: koreaderDeviceSweeps.deviceId }).from(koreaderDeviceSweeps).where(eq(koreaderDeviceSweeps.userId, userId)),
      this.db
        .selectDistinct({ deviceId: koreaderDeviceProgress.deviceId })
        .from(koreaderDeviceProgress)
        .where(eq(koreaderDeviceProgress.userId, userId)),
      this.db.select({ deviceId: koreaderDeviceSettings.deviceId }).from(koreaderDeviceSettings).where(eq(koreaderDeviceSettings.userId, userId)),
      this.db.select({ deviceId: koreaderDeviceNames.deviceId }).from(koreaderDeviceNames).where(eq(koreaderDeviceNames.userId, userId)),
    ]);
    return [...new Set([...sweeps, ...progress, ...settings, ...names].map((row) => row.deviceId))];
  }

  /**
   * Every hash an annotation exchange could have matched this book under, read the way the exchange
   * resolves them: the files' current hashes, their earlier ones, and the user's manual links.
   */
  async findBookHashes(userId: number, bookId: number): Promise<string[]> {
    const [current, history, links] = await Promise.all([
      this.db
        .select({ hash: bookFiles.fileHash })
        .from(bookFiles)
        .where(and(eq(bookFiles.bookId, bookId), isNotNull(bookFiles.fileHash))),
      this.db
        .select({ hash: bookFileHashHistory.fileHash })
        .from(bookFileHashHistory)
        .innerJoin(bookFiles, eq(bookFiles.id, bookFileHashHistory.bookFileId))
        .where(eq(bookFiles.bookId, bookId)),
      this.db
        .select({ hash: koreaderBookHashLinks.hash })
        .from(koreaderBookHashLinks)
        .innerJoin(bookFiles, eq(bookFiles.id, koreaderBookHashLinks.bookFileId))
        .where(and(eq(koreaderBookHashLinks.userId, userId), eq(bookFiles.bookId, bookId))),
    ]);
    return [...new Set([...current, ...history, ...links].flatMap((row) => (row.hash ? [row.hash.toLowerCase()] : [])))];
  }
}
