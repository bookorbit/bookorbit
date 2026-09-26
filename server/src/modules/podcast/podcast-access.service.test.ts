import { describe, expect, it, vi } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import { PodcastAccessService } from './podcast-access.service';

describe('PodcastAccessService', () => {
  const user = { id: 5, isSuperuser: false } as RequestUser;

  function createService() {
    const catalog = { findPodcast: vi.fn(), findPodcastLibrary: vi.fn() };
    const episodes = { findEpisodeForUser: vi.fn() };
    const playback = { findBookmarkAccess: vi.fn() };
    const libraries = { verifyUserAccessLevel: vi.fn() };
    return {
      service: new PodcastAccessService(catalog as never, episodes as never, playback as never, libraries as never),
      catalog,
      episodes,
      playback,
      libraries,
    };
  }

  it('checks podcast ownership with the requested access level and preserves the superuser flag', async () => {
    const { service, catalog, libraries } = createService();
    const podcast = { id: 3, libraryId: 7 };
    catalog.findPodcast.mockResolvedValue(podcast);

    await expect(service.requirePodcastAccess(3, { ...user, isSuperuser: true }, 'owner')).resolves.toBe(podcast);

    expect(libraries.verifyUserAccessLevel).toHaveBeenCalledWith(5, 7, true, 'owner');
  });

  it('does not run a library check when the podcast does not exist', async () => {
    const { service, catalog, libraries } = createService();
    catalog.findPodcast.mockResolvedValue(null);

    await expect(service.requirePodcastAccess(3, user)).rejects.toThrow('Podcast not found');
    expect(libraries.verifyUserAccessLevel).not.toHaveBeenCalled();
  });

  it('scopes episode lookup to the current user before checking its library', async () => {
    const { service, episodes, libraries } = createService();
    const context = { episode: { id: 11 }, podcast: { libraryId: 7 } };
    episodes.findEpisodeForUser.mockResolvedValue(context);

    await expect(service.requireEpisodeAccess(11, user, 'editor')).resolves.toBe(context);

    expect(episodes.findEpisodeForUser).toHaveBeenCalledWith(11, 5);
    expect(libraries.verifyUserAccessLevel).toHaveBeenCalledWith(5, 7, false, 'editor');
  });

  it('scopes bookmark lookup to the current user and requires viewer library access', async () => {
    const { service, playback, libraries } = createService();
    playback.findBookmarkAccess.mockResolvedValue({ libraryId: 7 });

    await service.requireBookmarkAccess(19, user);

    expect(playback.findBookmarkAccess).toHaveBeenCalledWith(5, 19);
    expect(libraries.verifyUserAccessLevel).toHaveBeenCalledWith(5, 7, false, 'viewer');
  });

  it('does not reveal a bookmark that is absent from the user-scoped query', async () => {
    const { service, playback, libraries } = createService();
    playback.findBookmarkAccess.mockResolvedValue(null);

    await expect(service.requireBookmarkAccess(19, user)).rejects.toThrow('Podcast bookmark not found');
    expect(libraries.verifyUserAccessLevel).not.toHaveBeenCalled();
  });

  it('accepts only libraries whose stored type is podcasts', async () => {
    const { service, catalog } = createService();
    catalog.findPodcastLibrary.mockResolvedValueOnce({ id: 7 }).mockResolvedValueOnce(null);

    await expect(service.requirePodcastLibrary(7)).resolves.toEqual({ id: 7 });
    await expect(service.requirePodcastLibrary(8)).rejects.toThrow('Podcast Library not found');
  });
});
