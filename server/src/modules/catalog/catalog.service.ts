import { Injectable } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { LibraryService } from '../library/library.service';
import { CatalogRepository, type CatalogSearchScope } from './catalog.repository';

@Injectable()
export class CatalogService {
  constructor(
    private readonly catalogRepository: CatalogRepository,
    private readonly libraryService: LibraryService,
  ) {}

  searchAuthors(user: RequestUser, q: string) {
    return this.searchVisible(user, q, (scope) => this.catalogRepository.searchAuthors(q, scope));
  }

  searchGenres(user: RequestUser, q: string) {
    return this.searchVisible(user, q, (scope) => this.catalogRepository.searchGenres(q, scope));
  }

  searchTags(user: RequestUser, q: string) {
    return this.searchVisible(user, q, (scope) => this.catalogRepository.searchTags(q, scope));
  }

  searchNarrators(user: RequestUser, q: string) {
    return this.searchVisible(user, q, (scope) => this.catalogRepository.searchNarrators(q, scope));
  }

  searchPublishers(user: RequestUser, q: string) {
    return this.searchVisible(user, q, (scope) => this.catalogRepository.searchPublishers(q, scope));
  }

  searchSeries(user: RequestUser, q: string) {
    return this.searchVisible(user, q, (scope) => this.catalogRepository.searchSeries(q, scope));
  }

  /**
   * A blank term lists every language the user can see rather than nothing: languages are a short
   * list, and the iOS library filter offers all of them at once. Every other suggestion endpoint
   * still needs a term.
   */
  searchLanguages(user: RequestUser, q: string) {
    if (!q.trim()) return this.inVisibleScope(user, (scope) => this.catalogRepository.listLanguages(scope));
    return this.searchVisible(user, q, (scope) => this.catalogRepository.searchLanguages(q, scope));
  }

  searchCollections(userId: number, q: string) {
    return this.catalogRepository.searchCollections(userId, q);
  }

  private async searchVisible<T>(user: RequestUser, q: string, search: (scope: CatalogSearchScope) => Promise<T[]>): Promise<T[]> {
    if (!q.trim()) return [];

    return this.inVisibleScope(user, search);
  }

  private async inVisibleScope<T>(user: RequestUser, search: (scope: CatalogSearchScope) => Promise<T[]>): Promise<T[]> {
    const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    if (libraryIds.length === 0) return [];

    return search({
      libraryIds,
      contentFilters: user.isSuperuser ? undefined : user.contentFilters,
    });
  }
}
