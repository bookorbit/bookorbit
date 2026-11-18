import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { emailProviders, emailRecipients, koboDevices, koboSyncSettings, koreaderUsers, opdsUsers } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface DeliverySummary {
  koboDevices: number;
  koboKepub: number;
  koboTwoWay: number;
  koreaderAccounts: number;
  opdsAccounts: number;
  emailProviders: number;
  emailShared: number;
  emailRecipients: number;
}

/**
 * How many devices and accounts books go out to, server wide.
 *
 * Counts only, in one round trip: the page says how the server is set up, so no row is loaded and
 * nothing that identifies a device or an address leaves this file.
 */
@Injectable()
export class DeliveryRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async summary(): Promise<DeliverySummary> {
    const result = await this.db.execute<Record<keyof DeliverySummary, number>>(sql`
      select
        (select count(*) from ${koboDevices})::int as "koboDevices",
        (select count(*) from ${koboSyncSettings} where ${koboSyncSettings.convertToKepub} = true)::int as "koboKepub",
        (select count(*) from ${koboSyncSettings} where ${koboSyncSettings.twoWayProgressSync} = true)::int as "koboTwoWay",
        (select count(*) from ${koreaderUsers} where ${koreaderUsers.syncEnabled} = true)::int as "koreaderAccounts",
        (select count(*) from ${opdsUsers})::int as "opdsAccounts",
        (select count(*) from ${emailProviders})::int as "emailProviders",
        (select count(*) from ${emailProviders} where ${emailProviders.isShared} = true)::int as "emailShared",
        (select count(*) from ${emailRecipients})::int as "emailRecipients"
    `);
    const row = result.rows[0];
    return {
      koboDevices: Number(row?.koboDevices ?? 0),
      koboKepub: Number(row?.koboKepub ?? 0),
      koboTwoWay: Number(row?.koboTwoWay ?? 0),
      koreaderAccounts: Number(row?.koreaderAccounts ?? 0),
      opdsAccounts: Number(row?.opdsAccounts ?? 0),
      emailProviders: Number(row?.emailProviders ?? 0),
      emailShared: Number(row?.emailShared ?? 0),
      emailRecipients: Number(row?.emailRecipients ?? 0),
    };
  }
}
