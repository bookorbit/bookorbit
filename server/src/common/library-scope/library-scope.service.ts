import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AccessLevel } from '@bookorbit/types';

import { apiKeyCredentialOf, type RequestUser } from '../types/request-user';
import { LibraryScopeRepository } from './library-scope.repository';

/** The fields library visibility depends on. A full `RequestUser` always satisfies it. */
export type LibraryScopeSubject = Pick<RequestUser, 'id' | 'isSuperuser'> & Partial<Pick<RequestUser, 'credential'>>;

const ACCESS_RANK: Record<AccessLevel, number> = { viewer: 1, editor: 2, owner: 3 };
const EDITOR_LEVELS: readonly AccessLevel[] = ['editor', 'owner'];

export function meetsAccessLevel(level: AccessLevel | null, required: AccessLevel): boolean {
  return level !== null && ACCESS_RANK[level] >= ACCESS_RANK[required];
}

/**
 * Which libraries the requesting principal may see or change, and at what level.
 *
 * "Superuser" used to mean both "has administrator powers" and "sees every library". An API key
 * separates the two: a superuser's key without administrator access is not `isSuperuser`, yet still
 * sees every library, and any key may be limited to fewer libraries than its owner. Every decision
 * about the requester's own libraries goes through here so that both rules hold on every route.
 * Questions about other users (who to notify, who loses access) do not.
 */
@Injectable()
export class LibraryScopeService {
  constructor(private readonly repo: LibraryScopeRepository) {}

  /** True when the principal sees every library, now and in future, with no list to filter by. */
  seesAllLibraries(user: LibraryScopeSubject): boolean {
    const credential = apiKeyCredentialOf(user);
    if (!credential) return user.isSuperuser;
    return credential.ownerIsSuperuser && credential.libraryIds === null;
  }

  /** Visible library ids in display order. */
  async visibleIds(user: LibraryScopeSubject): Promise<number[]> {
    if (this.seesAllLibraries(user)) return this.repo.findAllIds();
    return this.limitedIds(user);
  }

  /** Visible library ids, or null when the principal sees every library and no filter is needed. */
  async visibleIdsOrAll(user: LibraryScopeSubject): Promise<number[] | null> {
    if (this.seesAllLibraries(user)) return null;
    return this.limitedIds(user);
  }

  /**
   * The same answer for a caller that only holds a user id: device protocols (Kobo, the KOReader
   * sync and plugin endpoints) authenticate with their own credentials and act as the whole account.
   */
  async visibleIdsOrAllForUserId(userId: number): Promise<number[] | null> {
    return this.visibleIdsOrAll({ id: userId, isSuperuser: await this.repo.findIsSuperuser(userId) });
  }

  /** Library ids the principal may edit, in display order. */
  async editableIds(user: LibraryScopeSubject): Promise<number[]> {
    const credential = apiKeyCredentialOf(user);
    if (credential?.access === 'read') return [];
    if (this.seesAllLibraries(user)) return this.repo.findAllIds();
    return this.limitedIds(user, EDITOR_LEVELS);
  }

  /** The principal's level in one library, or null when it cannot see it. */
  async levelFor(user: LibraryScopeSubject, libraryId: number): Promise<AccessLevel | null> {
    const credential = apiKeyCredentialOf(user);
    if (credential?.libraryIds && !credential.libraryIds.includes(libraryId)) return null;
    const ownerIsSuperuser = credential ? credential.ownerIsSuperuser : user.isSuperuser;
    const level: AccessLevel | null = ownerIsSuperuser ? 'owner' : await this.repo.findGrantedLevel(user.id, libraryId);
    return this.capped(level, credential?.access);
  }

  async canSee(user: LibraryScopeSubject, libraryId: number): Promise<boolean> {
    return (await this.levelFor(user, libraryId)) !== null;
  }

  async assertVisible(user: LibraryScopeSubject, libraryId: number): Promise<void> {
    if (!(await this.canSee(user, libraryId))) throw new ForbiddenException('No access to this library');
  }

  async assertLevel(user: LibraryScopeSubject, libraryId: number, required: AccessLevel): Promise<void> {
    const level = await this.levelFor(user, libraryId);
    if (level === null) throw new ForbiddenException('No access to this library');
    if (!meetsAccessLevel(level, required)) throw new ForbiddenException('Insufficient library access level');
  }

  /** The given ids the principal can see, keeping their order. */
  async filterVisible(user: LibraryScopeSubject, libraryIds: readonly number[]): Promise<number[]> {
    if (libraryIds.length === 0) return [];
    const visible = await this.visibleIdsOrAll(user);
    if (visible === null) return [...libraryIds];
    const allowed = new Set(visible);
    return libraryIds.filter((id) => allowed.has(id));
  }

  /** Every visible library with the principal's level in it, in display order. */
  async visibleLevels(user: LibraryScopeSubject): Promise<{ id: number; accessLevel: AccessLevel }[]> {
    const credential = apiKeyCredentialOf(user);
    const ownerIsSuperuser = credential ? credential.ownerIsSuperuser : user.isSuperuser;
    let rows: { id: number; accessLevel: AccessLevel }[];
    if (ownerIsSuperuser) {
      const ids = credential?.libraryIds ? await this.repo.findExistingIds(credential.libraryIds) : await this.repo.findAllIds();
      rows = ids.map((id) => ({ id, accessLevel: 'owner' as AccessLevel }));
    } else {
      rows = await this.repo.findGrantedLevels(user.id);
      if (credential?.libraryIds) {
        const allowed = new Set(credential.libraryIds);
        rows = rows.filter(({ id }) => allowed.has(id));
      }
    }
    return rows.map(({ id, accessLevel }) => ({ id, accessLevel: this.capped(accessLevel, credential?.access)! }));
  }

  private async limitedIds(user: LibraryScopeSubject, levels?: readonly AccessLevel[]): Promise<number[]> {
    const credential = apiKeyCredentialOf(user);
    if (credential?.ownerIsSuperuser) return this.repo.findExistingIds(credential.libraryIds ?? []);
    const rows = await this.repo.findGrantedLevels(user.id, levels);
    const ids = rows.map(({ id }) => id);
    if (!credential?.libraryIds) return ids;
    const allowed = new Set(credential.libraryIds);
    return ids.filter((id) => allowed.has(id));
  }

  /** A read-only key never acts above viewer, whatever its owner holds. */
  private capped(level: AccessLevel | null, access: 'read' | 'write' | undefined): AccessLevel | null {
    if (level === null || access !== 'read') return level;
    return 'viewer';
  }
}
