import { customType } from 'drizzle-orm/pg-core';

import { parsePgTimestamptz } from '../../common/utils/pg-timestamp.utils';

/**
 * `timestamp with time zone` for columns that can hold a user-supplied date.
 *
 * Identical to `timestamp(name, { withTimezone: true })` on the wire; it only replaces the
 * decoder, because drizzle's own one misreads years below 100 and throws on 0013 to 0031.
 * See `parsePgTimestamptz`. Columns the application stamps itself (created/updated marks,
 * job timestamps) are always near the present, so plain `timestamp()` remains fine there.
 */
export const timestamptz = customType<{ data: Date; driverData: string }>({
  dataType: () => 'timestamp with time zone',
  toDriver: (value) => value.toISOString(),
  fromDriver: (value) => parsePgTimestamptz(value),
});
