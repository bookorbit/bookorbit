import { describe, expect, it } from 'vitest';

import { parseHardcoverBookId } from './hardcover-id.utils';

describe('parseHardcoverBookId', () => {
  it.each([
    ['1', 1],
    ['84', 84],
    ['00084', 84],
    ['2147483647', 2_147_483_647],
  ])('parses the complete positive GraphQL integer %s', (value, expected) => {
    expect(parseHardcoverBookId(value)).toBe(expected);
  });

  it.each([null, undefined, '', '0', '-84', '+84', '84.0', '84-charing-cross-road', '84abc', ' 84', '84 ', '2147483648', '9007199254740992'])(
    'rejects a value that is not a complete positive GraphQL integer: %s',
    (value) => {
      expect(parseHardcoverBookId(value)).toBeNull();
    },
  );
});
