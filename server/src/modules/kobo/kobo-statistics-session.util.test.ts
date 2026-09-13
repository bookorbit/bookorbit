import {
  KOBO_STATISTICS_SESSION_ID_PREFIX,
  koboSourceDeviceKey,
  koboStatisticsSessionId,
  koboStatisticsSessionIdPrefix,
} from './kobo-statistics-session.util';

describe('koboStatisticsSessionId', () => {
  it('carries the prefix the measured-session lookup excludes on', () => {
    expect(koboStatisticsSessionId(30, 53, 0, 860).startsWith(KOBO_STATISTICS_SESSION_ID_PREFIX)).toBe(true);
  });

  it('resolves a replayed push to the same id', () => {
    expect(koboStatisticsSessionId(30, 53, 0, 860)).toBe(koboStatisticsSessionId(30, 53, 0, 860));
  });

  it('separates devices, books, generations, and counter totals', () => {
    const base = koboStatisticsSessionId(30, 53, 0, 860);
    expect(koboStatisticsSessionId(31, 53, 0, 860)).not.toBe(base);
    expect(koboStatisticsSessionId(30, 54, 0, 860)).not.toBe(base);
    expect(koboStatisticsSessionId(30, 53, 1, 860)).not.toBe(base);
    expect(koboStatisticsSessionId(30, 53, 0, 861)).not.toBe(base);
  });

  it('builds the device key and estimate prefix from the same device id', () => {
    expect(koboSourceDeviceKey(30)).toBe('30');
    expect(koboStatisticsSessionIdPrefix(30)).toBe('kst:30:');
  });

  it('stays inside the session id column', () => {
    expect(koboStatisticsSessionId(2_147_483_647, 2_147_483_647, 2_147_483_647, 35_791_394).length).toBeLessThanOrEqual(64);
  });
});
