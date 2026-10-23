import { describe, expect, it } from 'vitest';

import {
  buildDeviceSessionIdPrefix,
  buildSessionId,
  buildSessionIdPrefix,
  koreaderSessionDeviceKey,
  parseKoreaderSessionId,
} from './koreader-session-id.utils';

const DEVICE_ID = 'abcdef12-3456-7890-abcd-ef1234567890';

describe('koreader session ids', () => {
  it('uses the complete device identity as its key', () => {
    expect(koreaderSessionDeviceKey(DEVICE_ID)).toBe('v2-b0a45058c4b94c71d047d1b1e532f5c9');
    expect(koreaderSessionDeviceKey('dev')).toMatch(/^v2-[a-f0-9]{32}$/);
  });

  it('keeps distinct devices with a shared prefix separate', () => {
    expect(koreaderSessionDeviceKey('same-key-A')).not.toBe(koreaderSessionDeviceKey('same-key-B'));
    expect(parseKoreaderSessionId('kor:abcdef12:42:1780000000')).toEqual({ deviceKey: 'abcdef12', bookFileId: 42, clusterStartEpoch: 1780000000 });
  });

  it('builds prefixes that nest inside each other', () => {
    expect(buildDeviceSessionIdPrefix(DEVICE_ID)).toBe('kor:v2-b0a45058c4b94c71d047d1b1e532f5c9:');
    expect(buildSessionIdPrefix(DEVICE_ID, 42)).toBe('kor:v2-b0a45058c4b94c71d047d1b1e532f5c9:42:');
    expect(buildSessionId(DEVICE_ID, 42, 1_780_000_000)).toBe('kor:v2-b0a45058c4b94c71d047d1b1e532f5c9:42:1780000000');
  });

  it.each([
    [DEVICE_ID, 42, 1_780_000_000],
    ['dev', 1, 0],
    ['e2e-stats-0001', 2_147_483_647, 2_147_483_647],
    ['A-B', 7, 5],
  ])('reads back what it builds for device %s', (deviceId, bookFileId, clusterStartEpoch) => {
    expect(parseKoreaderSessionId(buildSessionId(deviceId, bookFileId, clusterStartEpoch))).toEqual({
      deviceKey: koreaderSessionDeviceKey(deviceId),
      bookFileId,
      clusterStartEpoch,
    });
  });

  it.each([
    ['legacy estimator id', `ks-${'a'.repeat(12)}-${'b'.repeat(32)}`],
    ['web reader id', '3f1c2f9e-0d6b-4d5e-9a51-2b2c1d8e7f60'],
    ['kobo statistics id', 'kst:30:42:1:2'],
    ['missing cluster start', 'kor:abcdef12:42:'],
    ['device key longer than a key can be', 'kor:abcdef123:42:1780000000'],
    ['zero book file id', 'kor:abcdef12:0:1780000000'],
    ['non-numeric book file id', 'kor:abcdef12:x:1780000000'],
    ['trailing segment', 'kor:abcdef12:42:1780000000:9'],
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
  ])('rejects a %s', (_label, sessionId) => {
    expect(parseKoreaderSessionId(sessionId)).toBeNull();
  });
});
