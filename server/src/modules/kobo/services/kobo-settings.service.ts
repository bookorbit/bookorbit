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
  twoWayProgressSync: boolean;
  forceEnableHyphenation: boolean;
  kepubConversionLimitMb: number;
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
    return {
      readingThreshold: row.readingThreshold,
      finishedThreshold: row.finishedThreshold,
      convertToKepub: row.convertToKepub,
      twoWayProgressSync: row.twoWayProgressSync,
      forceEnableHyphenation: row.forceEnableHyphenation,
      kepubConversionLimitMb: row.kepubConversionLimitMb,
    };
  }

  async updateSettings(userId: number, patch: Partial<KoboSettings>): Promise<KoboSettings> {
    const current = await this.getSettings(userId);

    const newReading = patch.readingThreshold ?? current.readingThreshold;
    const newFinished = patch.finishedThreshold ?? current.finishedThreshold;

    if (newReading >= newFinished) {
      throw new BadRequestException('Reading threshold must be less than finished threshold');
    }

    const [updated] = await this.db
      .update(schema.koboSyncSettings)
      .set({
        readingThreshold: newReading,
        finishedThreshold: newFinished,
        convertToKepub: patch.convertToKepub ?? current.convertToKepub,
        twoWayProgressSync: patch.twoWayProgressSync ?? current.twoWayProgressSync,
        forceEnableHyphenation: patch.forceEnableHyphenation ?? current.forceEnableHyphenation,
        kepubConversionLimitMb: patch.kepubConversionLimitMb ?? current.kepubConversionLimitMb,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.koboSyncSettings.userId, userId))
      .returning();

    if (!updated) {
      throw new InternalServerErrorException('Failed to update kobo settings row');
    }

    return {
      readingThreshold: updated.readingThreshold,
      finishedThreshold: updated.finishedThreshold,
      convertToKepub: updated.convertToKepub,
      twoWayProgressSync: updated.twoWayProgressSync,
      forceEnableHyphenation: updated.forceEnableHyphenation,
      kepubConversionLimitMb: updated.kepubConversionLimitMb,
    };
  }
}
