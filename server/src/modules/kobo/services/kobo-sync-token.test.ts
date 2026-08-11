import { decodeSyncToken, encodeSyncToken, isUsableKoboSyncToken, withKoboSyncToken } from './kobo-sync-token';

describe('kobo sync token', () => {
  it('keeps the pre-store-sync token shape when there is no upstream cursor', () => {
    const token = encodeSyncToken(7);

    expect(token).toBe(`PX.${Buffer.from(JSON.stringify({ snapshotId: 7 })).toString('base64')}`);
    expect(decodeSyncToken(token)).toEqual({ snapshotId: 7, koboSyncToken: undefined });
  });

  it('round-trips both cursors', () => {
    expect(decodeSyncToken(encodeSyncToken(7, 'kobo-cursor'))).toEqual({ snapshotId: 7, koboSyncToken: 'kobo-cursor' });
  });

  it('reads tokens minted before store sync existed', () => {
    const legacy = `PX.${Buffer.from(JSON.stringify({ snapshotId: 3 })).toString('base64')}`;

    expect(decodeSyncToken(legacy)).toEqual({ snapshotId: 3, koboSyncToken: undefined });
  });

  it('treats an unprefixed token as Kobo’s own, for devices that synced with Kobo first', () => {
    expect(decodeSyncToken('kobo-opaque-token')).toEqual({ koboSyncToken: 'kobo-opaque-token' });
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace', '   '],
    ['malformed base64 payload', 'PX.!!!not-base64!!!'],
    ['a JSON array payload', `PX.${Buffer.from(JSON.stringify([1, 2])).toString('base64')}`],
    ['a non-object payload', `PX.${Buffer.from(JSON.stringify('nope')).toString('base64')}`],
  ])('never throws on %s', (_label, raw) => {
    expect(() => decodeSyncToken(raw)).not.toThrow();
    expect(decodeSyncToken(raw).snapshotId).toBeUndefined();
  });

  it('reports which upstream cursors can be carried, so callers can log the ones that cannot', () => {
    expect(isUsableKoboSyncToken('kobo-cursor')).toBe(true);
    expect(isUsableKoboSyncToken('x'.repeat(4096))).toBe(true);
    expect(isUsableKoboSyncToken('x'.repeat(4097))).toBe(false);
    expect(isUsableKoboSyncToken('')).toBe(false);
  });

  it('drops an oversized upstream cursor rather than growing the response header without bound', () => {
    const oversized = 'x'.repeat(4097);

    expect(decodeSyncToken(oversized)).toEqual({});
    expect(decodeSyncToken(encodeSyncToken(7, oversized))).toEqual({ snapshotId: 7, koboSyncToken: undefined });
  });

  it('leaves the token untouched when there is no upstream cursor to stamp', () => {
    const token = encodeSyncToken(7);

    expect(withKoboSyncToken(token, undefined)).toBe(token);
  });

  it('stamps the upstream cursor onto a token minted by the sync service', () => {
    expect(withKoboSyncToken(encodeSyncToken(7), 'kobo-cursor')).toBe(encodeSyncToken(7, 'kobo-cursor'));
  });

  it('returns an unreadable token unchanged rather than inventing a snapshot', () => {
    expect(withKoboSyncToken('PX.!!!', 'kobo-cursor')).toBe('PX.!!!');
  });
});
