import { describe, expect, it } from 'vitest';

import { isSemverNewer } from './semver.utils';

describe('isSemverNewer', () => {
  it.each([
    ['1.0.1', '1.0.0'],
    ['1.1.0', '1.0.9'],
    ['2.0.0', '1.99.99'],
    ['v1.2.3', '1.2.2'],
    ['1.2.3-beta.1', '1.2.2'],
  ])('returns true when %s is newer than %s', (candidate, current) => {
    expect(isSemverNewer(candidate, current)).toBe(true);
  });

  it.each([
    ['1.0.0', '1.0.0'],
    ['1.0.0', '1.0.1'],
    ['1.1.0', '2.0.0'],
    ['v1.2.3', '1.2.3'],
  ])('returns false when %s is not newer than %s', (candidate, current) => {
    expect(isSemverNewer(candidate, current)).toBe(false);
  });

  it.each([
    [null, '1.0.0'],
    ['unknown', '1.0.0'],
    ['1.0.0', null],
    ['1.0', '1.0.0'],
    ['1.0.0', 'local-build'],
  ])('returns null when %s cannot be compared to %s', (candidate, current) => {
    expect(isSemverNewer(candidate, current)).toBeNull();
  });
});
