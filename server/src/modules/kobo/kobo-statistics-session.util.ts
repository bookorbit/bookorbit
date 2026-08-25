/**
 * Identifiers for reading sessions derived from the reading counter a Kobo reports alongside
 * its bookmark, rather than measured from the analytics events it no longer sends.
 *
 * A reading session carries no column saying where it came from beyond `source`, and `source`
 * is `kobo` for both kinds. The prefix is what lets the derivation find, and exclude itself
 * from, the measured sessions it must never compete with.
 */
export const KOBO_STATISTICS_SESSION_ID_PREFIX = 'kst:';
export const KOBO_STATISTICS_CURSOR_SOURCE = 'kobo-statistics';

export function koboSourceDeviceKey(deviceId: number): string {
  return String(deviceId);
}

export function koboStatisticsSessionIdPrefix(deviceId: number): string {
  return `${KOBO_STATISTICS_SESSION_ID_PREFIX}${deviceId}:`;
}

/**
 * Derived rather than random, so a device replaying the same state push resolves to the id it
 * already spent and is dropped instead of counted again.
 *
 * The device and cursor generation keep independent devices and re-reads apart. The cumulative
 * counter makes retries within one generation idempotent.
 */
export function koboStatisticsSessionId(deviceId: number, bookFileId: number, generation: number, spentReadingMinutes: number): string {
  return `${koboStatisticsSessionIdPrefix(deviceId)}${bookFileId}:${generation}:${spentReadingMinutes}`;
}
