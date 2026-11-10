import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A requester's own library grants are read in one place, `LibraryScopeRepository`, so an API key's
 * library limit and a superuser key's "every library" both hold on every route. A new direct read
 * elsewhere would serve the owner's full library list to a key limited to fewer. The files below
 * read grants for another reason, and each says which.
 */
const ALLOWED: Record<string, string> = {
  'common/library-scope/library-scope.repository.ts': 'the scope data source',
  'modules/library/library.repository.ts':
    'grant management, member lists, and the per-user library list that LibraryService filters through the scope',
  'modules/user/user.repository.ts': 'administrator user management',
  'modules/auth/auth.service.ts': 'default library grants written at registration',
  'modules/notification/notification.repository.ts': 'fan-out: which users a notification reaches',
  'modules/scanner/scanner.repository.ts': 'fan-out: which users see a scan event',
  'modules/book-move/book-move.repository.ts': 'fan-out: which readers lose access when books move',
  'modules/book-merge/book-merge.repository.ts': 'fan-out: which readers a merge affects',
  'modules/achievement/achievement.repository.ts': 'account-level achievement evaluation, which runs for the account, not a request',
  'scripts/seed-apple-source-stats.ts': 'development seed script',
};

const GRANT_READ = /\buserLibraryAccess\b|\buser_library_access\b|\bfindAccessibleIdsForUser\b|\bhasUserAccess\b|\bfindUserAccessLevel\b/;

const SRC_ROOT = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === 'migrations' ? [] : sourceFiles(path);
    return entry.endsWith('.ts') && !entry.endsWith('.test.ts') ? [path] : [];
  });
}

describe('library scope guard', () => {
  const files = sourceFiles(SRC_ROOT)
    .map((path) => ({ path, name: relative(SRC_ROOT, path).split(sep).join('/') }))
    .filter((file) => !file.name.startsWith('db/schema/') && file.name !== 'metadata.ts');

  it('reads requester library grants only through LibraryScopeService', () => {
    const offenders = files.filter((file) => !(file.name in ALLOWED) && GRANT_READ.test(readFileSync(file.path, 'utf8'))).map((file) => file.name);
    expect(offenders).toEqual([]);
  });

  it('keeps the allow-list honest', () => {
    const stale = Object.keys(ALLOWED).filter((name) => {
      const file = files.find((candidate) => candidate.name === name);
      return !file || !GRANT_READ.test(readFileSync(file.path, 'utf8'));
    });
    expect(stale).toEqual([]);
  });
});
