import { BadRequestException } from '@nestjs/common';
import { relative, sep } from 'path';
import type { LibraryFolderRole } from '@bookorbit/types';

export interface LibraryFolderInput {
  path: string;
  role: LibraryFolderRole;
}

/**
 * Decides which role each folder of a library holds, and refuses the combinations that would make
 * the two roles unsafe to operate.
 *
 * A podcast library has exactly one `downloads` root, because BookOrbit has to know where its own
 * files go, plus any number of `local` roots holding folders the user brought. The roots may not
 * overlap: a local root inside the downloads root would put user files in the path of retention's
 * eviction sweep, and either kind nested in the other makes one folder answer to two sets of rules.
 *
 * Book libraries keep their existing shape - every root is `downloads` and overlap is not policed
 * here, because that has never been enforced for books and some libraries rely on it.
 */
export function resolveLibraryFolderRoles(type: string, folders: string[], localFolders: string[] | undefined): LibraryFolderInput[] {
  const local = localFolders ?? [];
  if (type !== 'podcasts') {
    if (local.length > 0) throw new BadRequestException('Local folders are only supported for podcast libraries');
    return folders.map((path) => ({ path, role: 'downloads' as const }));
  }
  if (folders.length !== 1) throw new BadRequestException('Podcast libraries require exactly one storage folder');

  const resolved: LibraryFolderInput[] = [
    ...folders.map((path) => ({ path, role: 'downloads' as const })),
    ...local.map((path) => ({ path, role: 'local' as const })),
  ];
  assertNoOverlap(resolved);
  return resolved;
}

function assertNoOverlap(folders: LibraryFolderInput[]): void {
  for (let i = 0; i < folders.length; i++) {
    for (let j = i + 1; j < folders.length; j++) {
      const a = folders[i]!;
      const b = folders[j]!;
      if (a.path === b.path) {
        throw new BadRequestException(`This folder is listed twice: ${a.path}`);
      }
      if (isInside(a.path, b.path) || isInside(b.path, a.path)) {
        throw new BadRequestException(`Podcast folders cannot contain one another: ${a.path} and ${b.path}`);
      }
    }
  }
}

function isInside(root: string, target: string): boolean {
  const relativePath = relative(root, target);
  return Boolean(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !relativePath.startsWith('../');
}
