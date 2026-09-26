import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { resolveLibraryFolderRoles } from './library-folder-roles.utils';

describe('resolveLibraryFolderRoles', () => {
  it('marks every root of a book library as downloads', () => {
    expect(resolveLibraryFolderRoles('books', ['/books/one', '/books/two'], undefined)).toEqual([
      { path: '/books/one', role: 'downloads' },
      { path: '/books/two', role: 'downloads' },
    ]);
  });

  it('refuses local folders on a book library', () => {
    expect(() => resolveLibraryFolderRoles('books', ['/books'], ['/archive'])).toThrow(BadRequestException);
  });

  it('pairs the podcast downloads root with any number of local roots', () => {
    expect(resolveLibraryFolderRoles('podcasts', ['/podcasts'], ['/archive/one', '/archive/two'])).toEqual([
      { path: '/podcasts', role: 'downloads' },
      { path: '/archive/one', role: 'local' },
      { path: '/archive/two', role: 'local' },
    ]);
  });

  it('accepts a podcast library with no local roots at all', () => {
    expect(resolveLibraryFolderRoles('podcasts', ['/podcasts'], [])).toEqual([{ path: '/podcasts', role: 'downloads' }]);
  });

  it('still requires exactly one podcast downloads root', () => {
    expect(() => resolveLibraryFolderRoles('podcasts', [], ['/archive'])).toThrow(/exactly one storage folder/i);
    expect(() => resolveLibraryFolderRoles('podcasts', ['/a', '/b'], [])).toThrow(/exactly one storage folder/i);
  });

  it('refuses a local root nested inside the downloads root', () => {
    // Retention evicts under the downloads root, so a user's archive underneath it would sit in the
    // path of a sweep that is allowed to delete.
    expect(() => resolveLibraryFolderRoles('podcasts', ['/podcasts'], ['/podcasts/archive'])).toThrow(/cannot contain one another/i);
  });

  it('refuses a downloads root nested inside a local root', () => {
    expect(() => resolveLibraryFolderRoles('podcasts', ['/archive/downloads'], ['/archive'])).toThrow(/cannot contain one another/i);
  });

  it('refuses the same folder listed under both roles', () => {
    expect(() => resolveLibraryFolderRoles('podcasts', ['/podcasts'], ['/podcasts'])).toThrow(/listed twice/i);
  });

  it('refuses one local root nested in another', () => {
    expect(() => resolveLibraryFolderRoles('podcasts', ['/podcasts'], ['/archive', '/archive/shows'])).toThrow(/cannot contain one another/i);
  });

  it('allows sibling roots that only share a name prefix', () => {
    expect(resolveLibraryFolderRoles('podcasts', ['/media/pods'], ['/media/pods-archive'])).toHaveLength(2);
  });
});
