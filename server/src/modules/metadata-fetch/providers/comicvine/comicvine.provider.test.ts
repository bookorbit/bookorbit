import { Test, TestingModule } from '@nestjs/testing';
import { MetadataProviderKey, ProviderConfigurations } from '@bookorbit/types';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { ProviderThrottleTracker } from '../../provider-throttle.tracker';
import { ComicVineClient } from './comicvine.client';
import { ComicVineProvider } from './comicvine.provider';

const mockConfig: ProviderConfigurations = {
  google: { enabled: false, apiKey: '' },
  amazon: { enabled: false, domain: 'amazon.com', cookie: '' },
  goodreads: { enabled: false },
  hardcover: { enabled: false, apiKey: '' },
  openLibrary: { enabled: false },
  itunes: { enabled: false, coverResolution: 'high' },
  audible: { enabled: false, domain: 'com' },
  audnexus: { enabled: false },
  comicvine: { enabled: true, apiKey: 'test-key' },
};

const mockVolume = {
  id: 1,
  name: 'Batman',
  start_year: '2016',
  count_of_issues: 50,
};

const mockIssue = {
  id: 100,
  name: 'Batman #1',
  issue_number: '1',
  volume: { id: 1, name: 'Batman' },
  person_credits: [{ id: 1, name: 'Tom King', role: 'writer' }],
  character_credits: [],
  team_credits: [],
  story_arc_credits: [],
  location_credits: [],
};

describe('ComicVineProvider', () => {
  let provider: ComicVineProvider;
  let client: ComicVineClient;
  let providerConfig: ProviderConfigService;
  let throttleTracker: ProviderThrottleTracker;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComicVineProvider,
        {
          provide: ComicVineClient,
          useValue: {
            searchVolumes: vi.fn().mockResolvedValue([]),
            searchIssuesInVolume: vi.fn().mockResolvedValue([]),
            searchIssues: vi.fn().mockResolvedValue([]),
            getIssueById: vi.fn().mockResolvedValue(null),
            windowResetMs: vi.fn().mockReturnValue(0),
          },
        },
        {
          provide: ProviderConfigService,
          useValue: {
            getConfig: vi.fn().mockResolvedValue(mockConfig),
          },
        },
        {
          provide: ProviderThrottleTracker,
          useValue: {
            record: vi.fn(),
            isThrottled: vi.fn().mockReturnValue(false),
            clearOnSuccess: vi.fn(),
          },
        },
      ],
    }).compile();

    provider = module.get(ComicVineProvider);
    client = module.get(ComicVineClient);
    providerConfig = module.get(ProviderConfigService);
    throttleTracker = module.get(ProviderThrottleTracker);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // search — guard clauses
  // ---------------------------------------------------------------------------

  describe('search - disabled / missing config', () => {
    it('returns empty array when provider is disabled', async () => {
      vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({
        ...mockConfig,
        comicvine: { enabled: false, apiKey: '' },
        ranobedb: { enabled: false },
      });

      expect(await provider.search({ title: 'Batman #1' })).toEqual([]);
      expect(client.searchVolumes).not.toHaveBeenCalled();
      expect(client.searchIssues).not.toHaveBeenCalled();
    });

    it('returns empty array when apiKey is missing', async () => {
      vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({
        ...mockConfig,
        comicvine: { enabled: true, apiKey: '' },
      });

      expect(await provider.search({ title: 'Batman #1' })).toEqual([]);
      expect(client.searchVolumes).not.toHaveBeenCalled();
    });

    it('returns empty array when title is missing', async () => {
      expect(await provider.search({})).toEqual([]);
      expect(client.searchVolumes).not.toHaveBeenCalled();
      expect(client.searchIssues).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // search — structured path (title matches "Series #N" pattern)
  // ---------------------------------------------------------------------------

  describe('search - structured path', () => {
    it('calls searchVolumes then searchIssuesInVolume for a parsed title', async () => {
      vi.spyOn(client, 'searchVolumes').mockResolvedValue([mockVolume]);
      vi.spyOn(client, 'searchIssuesInVolume').mockResolvedValue([mockIssue]);

      const results = await provider.search({ title: 'Batman #1' });

      expect(client.searchVolumes).toHaveBeenCalledWith('Batman', 'test-key');
      expect(client.searchIssuesInVolume).toHaveBeenCalledWith(mockVolume.id, '1', 'test-key');
      expect(results).toHaveLength(1);
    });

    it('tries volumes sorted by start_year descending', async () => {
      const older = { ...mockVolume, id: 1, start_year: '1990' };
      const newer = { ...mockVolume, id: 2, start_year: '2016' };
      vi.spyOn(client, 'searchVolumes').mockResolvedValue([older, newer]);
      vi.spyOn(client, 'searchIssuesInVolume').mockResolvedValue([mockIssue]);

      await provider.search({ title: 'Batman #1' });

      expect(client.searchIssuesInVolume).toHaveBeenNthCalledWith(1, newer.id, '1', 'test-key');
    });

    it('returns empty array when no volumes are found', async () => {
      vi.spyOn(client, 'searchVolumes').mockResolvedValue([]);

      expect(await provider.search({ title: 'Batman #1' })).toEqual([]);
      expect(client.searchIssuesInVolume).not.toHaveBeenCalled();
    });

    it('tries next volume when first has no matching issues', async () => {
      const v1 = { ...mockVolume, id: 1 };
      const v2 = { ...mockVolume, id: 2 };
      vi.spyOn(client, 'searchVolumes').mockResolvedValue([v1, v2]);
      vi.spyOn(client, 'searchIssuesInVolume').mockResolvedValueOnce([]).mockResolvedValueOnce([mockIssue]);

      const results = await provider.search({ title: 'Batman #1' });

      expect(client.searchIssuesInVolume).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(1);
    });

    it('returns empty array when no volume has matching issues', async () => {
      vi.spyOn(client, 'searchVolumes').mockResolvedValue([mockVolume]);
      vi.spyOn(client, 'searchIssuesInVolume').mockResolvedValue([]);

      expect(await provider.search({ title: 'Batman #1' })).toEqual([]);
    });

    it('fetches issue detail when issue has no credits', async () => {
      const issueNoCredits = {
        ...mockIssue,
        person_credits: [],
        character_credits: [],
        team_credits: [],
        story_arc_credits: [],
        location_credits: [],
      };
      const issueWithCredits = { ...mockIssue };
      vi.spyOn(client, 'searchVolumes').mockResolvedValue([mockVolume]);
      vi.spyOn(client, 'searchIssuesInVolume').mockResolvedValue([issueNoCredits]);
      vi.spyOn(client, 'getIssueById').mockResolvedValue(issueWithCredits);

      await provider.search({ title: 'Batman #1' });

      expect(client.getIssueById).toHaveBeenCalledWith(String(issueNoCredits.id), 'test-key');
    });

    it('skips detail fetch when issue already has credits', async () => {
      vi.spyOn(client, 'searchVolumes').mockResolvedValue([mockVolume]);
      vi.spyOn(client, 'searchIssuesInVolume').mockResolvedValue([mockIssue]);

      await provider.search({ title: 'Batman #1' });

      expect(client.getIssueById).not.toHaveBeenCalled();
    });

    it('falls back to list-endpoint issue if detail fetch returns null', async () => {
      const issueNoCredits = {
        ...mockIssue,
        person_credits: [],
        character_credits: [],
        team_credits: [],
        story_arc_credits: [],
        location_credits: [],
      };
      vi.spyOn(client, 'searchVolumes').mockResolvedValue([mockVolume]);
      vi.spyOn(client, 'searchIssuesInVolume').mockResolvedValue([issueNoCredits]);
      vi.spyOn(client, 'getIssueById').mockResolvedValue(null);

      const results = await provider.search({ title: 'Batman #1' });

      expect(results).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // search — general path (title does not match pattern)
  // ---------------------------------------------------------------------------

  describe('search - general path', () => {
    it('calls searchIssues when title does not match the issue pattern', async () => {
      vi.spyOn(client, 'searchIssues').mockResolvedValue([mockIssue]);

      await provider.search({ title: 'Batman' });

      expect(client.searchIssues).toHaveBeenCalledWith('Batman', 'test-key');
      expect(client.searchVolumes).not.toHaveBeenCalled();
    });

    it('returns empty array when searchIssues returns nothing', async () => {
      vi.spyOn(client, 'searchIssues').mockResolvedValue([]);

      expect(await provider.search({ title: 'Unknown Comic' })).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // search — throttle handling
  // ---------------------------------------------------------------------------

  describe('search - throttle handling', () => {
    it('returns empty array and records throttle when client throws ProviderThrottleError', async () => {
      vi.spyOn(client, 'searchVolumes').mockRejectedValue(new ProviderThrottleError());
      vi.spyOn(client, 'windowResetMs').mockReturnValue(0);

      const result = await provider.search({ title: 'Batman #1' });

      expect(result).toEqual([]);
      expect(throttleTracker.record).toHaveBeenCalledWith(MetadataProviderKey.COMICVINE, undefined);
    });

    it('passes precise retryAfterSeconds derived from windowResetMs to the tracker', async () => {
      vi.spyOn(client, 'searchVolumes').mockRejectedValue(new ProviderThrottleError());
      vi.spyOn(client, 'windowResetMs').mockReturnValue(62_000); // 62 seconds remaining

      await provider.search({ title: 'Batman #1' });

      expect(throttleTracker.record).toHaveBeenCalledWith(MetadataProviderKey.COMICVINE, 62);
    });

    it('ceils fractional seconds when computing retryAfterSeconds', async () => {
      vi.spyOn(client, 'searchIssues').mockRejectedValue(new ProviderThrottleError());
      vi.spyOn(client, 'windowResetMs').mockReturnValue(61_001); // 61.001 seconds

      await provider.search({ title: 'Batman' });

      expect(throttleTracker.record).toHaveBeenCalledWith(MetadataProviderKey.COMICVINE, 62);
    });

    it('passes undefined retryAfterSeconds when windowResetMs returns 0', async () => {
      vi.spyOn(client, 'searchIssues').mockRejectedValue(new ProviderThrottleError());
      vi.spyOn(client, 'windowResetMs').mockReturnValue(0);

      await provider.search({ title: 'Batman' });

      expect(throttleTracker.record).toHaveBeenCalledWith(MetadataProviderKey.COMICVINE, undefined);
    });

    it('rethrows non-throttle errors from search', async () => {
      vi.spyOn(client, 'searchVolumes').mockRejectedValue(new Error('Unexpected'));

      await expect(provider.search({ title: 'Batman #1' })).rejects.toThrow('Unexpected');
      expect(throttleTracker.record).not.toHaveBeenCalled();
    });

    it('throttle on general path also records and returns empty array', async () => {
      vi.spyOn(client, 'searchIssues').mockRejectedValue(new ProviderThrottleError());
      vi.spyOn(client, 'windowResetMs').mockReturnValue(120_000);

      const result = await provider.search({ title: 'Batman' });

      expect(result).toEqual([]);
      expect(throttleTracker.record).toHaveBeenCalledWith(MetadataProviderKey.COMICVINE, 120);
    });
  });

  // ---------------------------------------------------------------------------
  // lookupById
  // ---------------------------------------------------------------------------

  describe('lookupById', () => {
    it('returns null when disabled', async () => {
      vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({
        ...mockConfig,
        comicvine: { enabled: false, apiKey: '' },
        ranobedb: { enabled: false },
      });

      expect(await provider.lookupById('100')).toBeNull();
      expect(client.getIssueById).not.toHaveBeenCalled();
    });

    it('returns null when apiKey is missing', async () => {
      vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({
        ...mockConfig,
        comicvine: { enabled: true, apiKey: '' },
      });

      expect(await provider.lookupById('100')).toBeNull();
      expect(client.getIssueById).not.toHaveBeenCalled();
    });

    it('returns mapped candidate when issue is found', async () => {
      vi.spyOn(client, 'getIssueById').mockResolvedValue(mockIssue);

      const result = await provider.lookupById('100');

      expect(client.getIssueById).toHaveBeenCalledWith('100', 'test-key');
      expect(result).not.toBeNull();
    });

    it('returns null when issue is not found', async () => {
      vi.spyOn(client, 'getIssueById').mockResolvedValue(null);

      expect(await provider.lookupById('999')).toBeNull();
    });

    it('returns null and records throttle on ProviderThrottleError', async () => {
      vi.spyOn(client, 'getIssueById').mockRejectedValue(new ProviderThrottleError());
      vi.spyOn(client, 'windowResetMs').mockReturnValue(3_600_000);

      const result = await provider.lookupById('100');

      expect(result).toBeNull();
      expect(throttleTracker.record).toHaveBeenCalledWith(MetadataProviderKey.COMICVINE, 3600);
    });

    it('rethrows non-throttle errors', async () => {
      vi.spyOn(client, 'getIssueById').mockRejectedValue(new Error('DB error'));

      await expect(provider.lookupById('100')).rejects.toThrow('DB error');
      expect(throttleTracker.record).not.toHaveBeenCalled();
    });
  });
});
