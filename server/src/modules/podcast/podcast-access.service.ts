import { Injectable, NotFoundException } from '@nestjs/common';
import type { AccessLevel } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { LibraryService } from '../library/library.service';
import { PodcastCatalogRepository } from './podcast-catalog.repository';
import { PodcastEpisodeRepository } from './podcast-episode.repository';
import { PodcastPlaybackRepository } from './podcast-playback.repository';

@Injectable()
export class PodcastAccessService {
  constructor(
    private readonly catalog: PodcastCatalogRepository,
    private readonly episodes: PodcastEpisodeRepository,
    private readonly playback: PodcastPlaybackRepository,
    private readonly libraries: LibraryService,
  ) {}

  async requireEpisodeAccess(episodeId: number, user: RequestUser, required: AccessLevel = 'viewer') {
    const context = await this.episodes.findEpisodeForUser(episodeId, user.id);
    if (!context) throw new NotFoundException('Podcast episode not found');
    await this.libraries.verifyUserAccessLevel(user.id, context.podcast.libraryId, user.isSuperuser, required);
    return context;
  }

  async requirePodcastAccess(podcastId: number, user: RequestUser, required: AccessLevel = 'viewer') {
    const podcast = await this.catalog.findPodcast(podcastId);
    if (!podcast) throw new NotFoundException('Podcast not found');
    await this.libraries.verifyUserAccessLevel(user.id, podcast.libraryId, user.isSuperuser, required);
    return podcast;
  }

  async requireBookmarkAccess(bookmarkId: number, user: RequestUser): Promise<void> {
    const bookmark = await this.playback.findBookmarkAccess(user.id, bookmarkId);
    if (!bookmark) throw new NotFoundException('Podcast bookmark not found');
    await this.libraries.verifyUserAccessLevel(user.id, bookmark.libraryId, user.isSuperuser, 'viewer');
  }

  /**
   * Type assertion only. Safe on the podcast-library routes, where `@RequireLibraryAccess`
   * has already authorized the caller against the `:libraryId` route param.
   */
  async requirePodcastLibrary(libraryId: number) {
    const library = await this.catalog.findPodcastLibrary(libraryId);
    if (!library) throw new NotFoundException('Podcast Library not found');
    return library;
  }

  /**
   * Type assertion plus authorization, for callers that reach a podcast library through
   * something other than a `:libraryId` route param, such as a podcast smart scope or a
   * podcast collection. Those routes have no library param for the guard to act on, so the
   * access check has to happen here or not at all.
   */
  async requirePodcastLibraryAccess(libraryId: number, user: RequestUser, required: AccessLevel = 'viewer') {
    const library = await this.requirePodcastLibrary(libraryId);
    await this.libraries.verifyUserAccessLevel(user.id, libraryId, user.isSuperuser, required);
    return library;
  }
}
