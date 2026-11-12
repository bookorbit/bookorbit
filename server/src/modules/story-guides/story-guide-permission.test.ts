import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { API_KEY_GRANTABLE_PERMISSIONS, Permission, PERMISSION_LABELS, PERMISSION_REQUIRES, RESTRICTIVE_PERMISSIONS } from '@bookorbit/types';

describe('LibraryGenerateStoryGuide', () => {
  it('is a grant of its own, with a label, that needs no other permission', () => {
    expect(Permission.LibraryGenerateStoryGuide).toBe('library_generate_story_guide');
    expect(PERMISSION_LABELS[Permission.LibraryGenerateStoryGuide]).toBe('Build story guides');
    expect(RESTRICTIVE_PERMISSIONS).not.toContain(Permission.LibraryGenerateStoryGuide);
    expect(PERMISSION_REQUIRES[Permission.LibraryGenerateStoryGuide]).toBeUndefined();
    expect(API_KEY_GRANTABLE_PERMISSIONS).toContain(Permission.LibraryGenerateStoryGuide);
  });

  it('is off for every existing account: no migration grants it', () => {
    const dir = join(__dirname, '..', '..', 'db', 'migrations');
    const granting = readdirSync(dir)
      .filter((file) => file.endsWith('.sql'))
      .filter((file) => readFileSync(join(dir, file), 'utf8').includes(Permission.LibraryGenerateStoryGuide));
    expect(granting).toEqual([]);
  });
});
