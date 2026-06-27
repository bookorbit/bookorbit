import { BadRequestException, Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface KoboSettings {
  readingThreshold: number;
  finishedThreshold: number;
  convertToKepub: boolean;
  forceEnableHyphenation: boolean;
  kepubConversionLimitMb: number;
  twoWayProgressSync: boolean;
  syncBookOrbitAnnotationsToKobo: boolean;
}

@Injectable()
export class KoboSettingsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async getSettings(userId: number): Promise<KoboSettings> {
    let row = await this.db.query.koboSyncSettings.findFirst({
      where: eq(schema.koboSyncSettings.userId, userId),
    });

    if (!row) {
      const [inserted] = await this.db.insert(schema.koboSyncSettings).values({ userId }).onConflictDoNothing().returning();
      row = inserted ?? (await this.db.query.koboSyncSettings.findFirst({ where: eq(schema.koboSyncSettings.userId, userId) }));
    }

    if (!row) throw new InternalServerErrorException('Failed to create kobo settings row');
    if ((row.twoWayProgressSync || row.syncBookOrbitAnnotationsToKobo) && !row.convertToKepub) {
      const [updated] = await this.db
        .update(schema.koboSyncSettings)
        .set({ convertToKepub: true, updatedAt: sql`now()` })
        .where(eq(schema.koboSyncSettings.userId, userId))
        .returning();
      row = updated ?? { ...row, convertToKepub: true };
      await this.markSnapshotDeliveryChanged(userId);
    }

    return {
      readingThreshold: row.readingThreshold,
      finishedThreshold: row.finishedThreshold,
      convertToKepub: row.convertToKepub,
      forceEnableHyphenation: row.forceEnableHyphenation,
      kepubConversionLimitMb: row.kepubConversionLimitMb,
      twoWayProgressSync: row.twoWayProgressSync,
      syncBookOrbitAnnotationsToKobo: row.syncBookOrbitAnnotationsToKobo,
    };
  }

  async updateSettings(userId: number, patch: Partial<KoboSettings>): Promise<KoboSettings> {
    const current = await this.getSettings(userId);

    const newReading = patch.readingThreshold ?? current.readingThreshold;
    const newFinished = patch.finishedThreshold ?? current.finishedThreshold;
    const newTwoWayProgressSync = patch.twoWayProgressSync ?? current.twoWayProgressSync;
    const newAnnotationSync = patch.syncBookOrbitAnnotationsToKobo ?? current.syncBookOrbitAnnotationsToKobo;
    const newConvertToKepub = newTwoWayProgressSync || newAnnotationSync ? true : (patch.convertToKepub ?? current.convertToKepub);

    if (newReading >= newFinished) {
      throw new BadRequestException('Reading threshold must be less than finished threshold');
    }

    const [updated] = await this.db
      .update(schema.koboSyncSettings)
      .set({
        readingThreshold: newReading,
        finishedThreshold: newFinished,
        convertToKepub: newConvertToKepub,
        forceEnableHyphenation: patch.forceEnableHyphenation ?? current.forceEnableHyphenation,
        kepubConversionLimitMb: patch.kepubConversionLimitMb ?? current.kepubConversionLimitMb,
        twoWayProgressSync: newTwoWayProgressSync,
        syncBookOrbitAnnotationsToKobo: newAnnotationSync,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.koboSyncSettings.userId, userId))
      .returning();

    if (!updated) {
      throw new InternalServerErrorException('Failed to update kobo settings row');
    }

    if (this.deliverySettingsChanged(current, updated)) {
      await this.markSnapshotDeliveryChanged(userId);
    }

    return {
      readingThreshold: updated.readingThreshold,
      finishedThreshold: updated.finishedThreshold,
      convertToKepub: updated.convertToKepub,
      forceEnableHyphenation: updated.forceEnableHyphenation,
      kepubConversionLimitMb: updated.kepubConversionLimitMb,
      twoWayProgressSync: updated.twoWayProgressSync,
      syncBookOrbitAnnotationsToKobo: updated.syncBookOrbitAnnotationsToKobo,
    };
  }

  private deliverySettingsChanged(
    current: Pick<KoboSettings, 'convertToKepub' | 'forceEnableHyphenation' | 'kepubConversionLimitMb'>,
    updated: Pick<KoboSettings, 'convertToKepub' | 'forceEnableHyphenation' | 'kepubConversionLimitMb'>,
  ): boolean {
    return (
      current.convertToKepub !== updated.convertToKepub ||
      current.kepubConversionLimitMb !== updated.kepubConversionLimitMb ||
      ((current.convertToKepub || updated.convertToKepub) && current.forceEnableHyphenation !== updated.forceEnableHyphenation)
    );
  }

  private async markSnapshotDeliveryChanged(userId: number): Promise<void> {
    await this.db.execute(sql`
      UPDATE ${schema.koboSnapshotBooks} AS sb
      SET synced = false,
          is_new = true,
          delivery_hash = NULL
      FROM ${schema.koboLibrarySnapshots} AS snap
      WHERE snap.id = sb.snapshot_id
        AND snap.user_id = ${userId}
        AND sb.pending_delete = false
        AND sb.removed_by_device = false
    `);
  }
}
