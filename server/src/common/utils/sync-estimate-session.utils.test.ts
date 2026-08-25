import { describe, expect, it } from 'vitest';

import { syncEstimateSessionId, syncEstimateSessionIdPrefix } from './sync-estimate-session.utils';

describe('sync estimate session ids', () => {
  it('fits the session_id column, whatever the device calls itself', () => {
    const longDeviceId = 'd'.repeat(100);

    // varchar(64) on reading_sessions.session_id, and a device id may be up to 100 characters.
    expect(syncEstimateSessionId(longDeviceId, 1_000_000, 1_782_870_480_000).length).toBeLessThanOrEqual(64);
    expect(syncEstimateSessionId('device-12', 44, 1_782_870_480_000)).toMatch(/^ks-[0-9a-f]{12}-[0-9a-f]{32}$/);
  });

  it('resolves one interval to one id, so a repeated push is dropped rather than counted again', () => {
    expect(syncEstimateSessionId('device-12', 44, 1_782_870_480_000)).toBe(syncEstimateSessionId('device-12', 44, 1_782_870_480_000));
  });

  it('separates devices, books, and intervals', () => {
    const base = syncEstimateSessionId('device-12', 44, 1_782_870_480_000);

    expect(syncEstimateSessionId('device-99', 44, 1_782_870_480_000)).not.toBe(base);
    expect(syncEstimateSessionId('device-12', 45, 1_782_870_480_000)).not.toBe(base);
    expect(syncEstimateSessionId('device-12', 44, 1_782_870_540_000)).not.toBe(base);
  });

  it('shares the device half across every estimate that device makes, so they can be retired together', () => {
    const prefix = syncEstimateSessionIdPrefix('device-12');

    expect(syncEstimateSessionId('device-12', 44, 1_782_870_480_000).startsWith(prefix)).toBe(true);
    expect(syncEstimateSessionId('device-12', 77, 1_782_999_999_000).startsWith(prefix)).toBe(true);
    expect(syncEstimateSessionId('device-99', 44, 1_782_870_480_000).startsWith(prefix)).toBe(false);
  });
});
