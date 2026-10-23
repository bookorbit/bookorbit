import { decodeSyncToken, encodeSyncToken, isUsableKoboSyncToken, withKoboSyncToken } from './kobo-sync-token';

function base64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64');
}

describe('kobo sync token', () => {
  it('hands the device the token Calibre-Web sends when there is no upstream cursor (#1175)', () => {
    const token = encodeSyncToken();

    expect(JSON.parse(Buffer.from(token, 'base64').toString('utf8'))).toEqual({
      version: '1-1-0',
      data: {
        raw_kobo_store_token: '',
        books_last_modified: -62135596800,
        books_last_created: -62135596800,
        archive_last_modified: -62135596800,
        reading_state_last_modified: -62135596800,
        tags_last_modified: -62135596800,
      },
    });
    expect(token).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(decodeSyncToken(token)).toEqual({});
  });

  it('hands the device Kobo’s own cursor verbatim when there is one', () => {
    const cursor = 'eyJJbnRlcm5hbFN5bmNUb2tlbiI6ImV5SjAifQ.eyJ0eXAiOjF9';

    expect(encodeSyncToken(cursor)).toBe(cursor);
    expect(decodeSyncToken(cursor)).toEqual({ koboSyncToken: cursor });
  });

  it('reads the store cursor out of a Calibre-Web token, ours or one Calibre-Web left behind', () => {
    const token = base64Json({ data: { raw_kobo_store_token: 'kobo-cursor', books_last_modified: 1700000000 }, version: '1-1-0' });

    expect(decodeSyncToken(token)).toEqual({ koboSyncToken: 'kobo-cursor' });
  });

  it('still reads the cursor from compact PX2 tokens devices already hold', () => {
    const cursor = 'eyJJbnRlcm5hbFN5bmNUb2tlbiI6ImV5SjAifQ.eyJ0eXAiOjF9';

    expect(decodeSyncToken(`PX2.7.${cursor}`)).toEqual({ koboSyncToken: cursor });
    expect(decodeSyncToken('PX2.7')).toEqual({});
  });

  it('still reads PX tokens, with and without a store cursor', () => {
    expect(decodeSyncToken(`PX.${base64Json({ snapshotId: 3, koboSyncToken: 'kobo-cursor' })}`)).toEqual({ koboSyncToken: 'kobo-cursor' });
    expect(decodeSyncToken(`PX.${base64Json({ snapshotId: 3 })}`)).toEqual({});
  });

  it('treats an unprefixed token it cannot parse as Kobo’s own, for devices that synced with Kobo first', () => {
    expect(decodeSyncToken('kobo-opaque-token')).toEqual({ koboSyncToken: 'kobo-opaque-token' });
  });

  it('keeps the header within a proxy line limit for the largest cursor it carries', () => {
    expect(encodeSyncToken('x'.repeat(7000)).length).toBeLessThan(8000);
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace', '   '],
    ['malformed base64 payload', 'PX.!!!not-base64!!!'],
    ['a JSON array payload', `PX.${base64Json([1, 2])}`],
    ['a non-object payload', `PX.${base64Json('nope')}`],
    ['a Calibre-Web token with no data', base64Json({ version: '1-1-0' })],
    ['a Calibre-Web token with a non-string cursor', base64Json({ data: { raw_kobo_store_token: 42 } })],
    ['a compact token with nothing after the prefix', 'PX2.'],
  ])('never throws on %s', (_label, raw) => {
    expect(() => decodeSyncToken(raw)).not.toThrow();
  });

  it('reports which upstream cursors can be carried, so callers can log the ones that cannot', () => {
    expect(isUsableKoboSyncToken('kobo-cursor')).toBe(true);
    expect(isUsableKoboSyncToken('x'.repeat(7000))).toBe(true);
    expect(isUsableKoboSyncToken('x'.repeat(7001))).toBe(false);
    expect(isUsableKoboSyncToken('')).toBe(false);
  });

  it('drops an oversized upstream cursor rather than growing the response header without bound', () => {
    const oversized = 'x'.repeat(7001);

    expect(decodeSyncToken(oversized)).toEqual({});
    expect(encodeSyncToken(oversized)).toBe(encodeSyncToken());
    expect(withKoboSyncToken(encodeSyncToken(), oversized)).toBe(encodeSyncToken());
  });

  it('leaves the token untouched when there is no upstream cursor to stamp', () => {
    const token = encodeSyncToken();

    expect(withKoboSyncToken(token, undefined)).toBe(token);
  });

  it('replaces the token minted by the sync service with the upstream cursor', () => {
    expect(withKoboSyncToken(encodeSyncToken(), 'kobo-cursor')).toBe('kobo-cursor');
  });
});
