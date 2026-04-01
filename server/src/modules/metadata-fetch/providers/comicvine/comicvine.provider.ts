import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@projectx/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { ProviderThrottleTracker } from '../../provider-throttle.tracker';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { IdentifiableProvider } from '../metadata-provider';
import { MetadataSearchParams } from '../metadata-search-params';
import { PROVIDER_LIMITS } from '../provider-constants';
import { normalizeMaxCandidates } from '../provider-utils';
import { ComicVineClient } from './comicvine.client';
import { mapIssueToCandidate } from './comicvine.mapper';
import { ComicVineIssue } from './comicvine.types';

const ISSUE_PATTERN = /^(.*?)\s*#(\d[\d.]*)(.*)$/;

interface ParsedIssueTitle {
  seriesName: string;
  issueNumber: string;
}

function parseIssueTitle(title: string): ParsedIssueTitle | null {
  const match = ISSUE_PATTERN.exec(title.trim());
  if (!match) return null;
  const seriesName = match[1].trim();
  const issueNumber = match[2].trim();
  if (!seriesName || !issueNumber) return null;
  return { seriesName, issueNumber };
}

function hasAnyCredits(issue: ComicVineIssue): boolean {
  return (
    (issue.person_credits?.length ?? 0) > 0 ||
    (issue.character_credits?.length ?? 0) > 0 ||
    (issue.team_credits?.length ?? 0) > 0 ||
    (issue.story_arc_credits?.length ?? 0) > 0 ||
    (issue.location_credits?.length ?? 0) > 0
  );
}

@Injectable()
export class ComicVineProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.COMICVINE;
  readonly label = 'ComicVine';
  readonly identifiable = true as const;

  private readonly logger = new Logger(ComicVineProvider.name);

  constructor(
    private readonly client: ComicVineClient,
    private readonly providerConfig: ProviderConfigService,
    private readonly throttleTracker: ProviderThrottleTracker,
  ) {}

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const { enabled, apiKey } = await this.providerConfig.getConfig().then((c) => c.comicvine);
    if (!enabled || !apiKey) {
      this.logger.debug(`ComicVine skipped: enabled=${enabled} hasApiKey=${!!apiKey}`);
      return [];
    }
    if (!params.title) return [];

    try {
      const maxCandidates = normalizeMaxCandidates(params.maxCandidatesPerProvider, PROVIDER_LIMITS.COMICVINE_MAX_RESULTS);
      const parsed = parseIssueTitle(params.title);
      return parsed
        ? await this.structuredSearch(parsed.seriesName, parsed.issueNumber, apiKey, maxCandidates, params.signal)
        : await this.generalSearch(params.title, apiKey, maxCandidates, params.signal);
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.recordThrottle();
        return [];
      }
      throw err;
    }
  }

  async lookupById(providerId: string, signal?: AbortSignal): Promise<MetadataCandidate | null> {
    const { enabled, apiKey } = await this.providerConfig.getConfig().then((c) => c.comicvine);
    if (!enabled || !apiKey) return null;

    try {
      const issue = signal ? await this.client.getIssueById(providerId, apiKey, signal) : await this.client.getIssueById(providerId, apiKey);
      return issue ? mapIssueToCandidate(issue) : null;
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.recordThrottle();
        return null;
      }
      throw err;
    }
  }

  private recordThrottle(): void {
    const waitMs = this.client.windowResetMs();
    const retryAfterSeconds = waitMs > 0 ? Math.ceil(waitMs / 1000) : undefined;
    this.throttleTracker.record(MetadataProviderKey.COMICVINE, retryAfterSeconds);
  }

  private async structuredSearch(
    seriesName: string,
    issueNumber: string,
    apiKey: string,
    maxCandidates: number,
    signal?: AbortSignal,
  ): Promise<MetadataCandidate[]> {
    const volumes = signal ? await this.client.searchVolumes(seriesName, apiKey, signal) : await this.client.searchVolumes(seriesName, apiKey);
    if (volumes.length === 0) {
      this.logger.debug(`ComicVine: no volumes found for "${seriesName}"`);
      return [];
    }

    const sorted = [...volumes].sort((a, b) => {
      const yearA = a.start_year ? parseInt(a.start_year, 10) : 0;
      const yearB = b.start_year ? parseInt(b.start_year, 10) : 0;
      return yearB - yearA;
    });

    for (const volume of sorted.slice(0, 8)) {
      const issues = signal
        ? await this.client.searchIssuesInVolume(volume.id, issueNumber, apiKey, signal)
        : await this.client.searchIssuesInVolume(volume.id, issueNumber, apiKey);
      if (issues.length > 0) {
        const enriched = await Promise.all(issues.slice(0, maxCandidates).map((issue) => this.enrichWithDetails(issue, apiKey, signal)));
        return enriched.map(mapIssueToCandidate);
      }
    }

    this.logger.debug(`ComicVine: no issues found for "${seriesName}" #${issueNumber}`);
    return [];
  }

  private async generalSearch(query: string, apiKey: string, maxCandidates: number, signal?: AbortSignal): Promise<MetadataCandidate[]> {
    const issues = signal ? await this.client.searchIssues(query, apiKey, signal) : await this.client.searchIssues(query, apiKey);
    const enriched = await Promise.all(issues.slice(0, maxCandidates).map((issue) => this.enrichWithDetails(issue, apiKey, signal)));
    return enriched.map(mapIssueToCandidate);
  }

  private async enrichWithDetails(issue: ComicVineIssue, apiKey: string, signal?: AbortSignal): Promise<ComicVineIssue> {
    if (hasAnyCredits(issue)) return issue;
    this.logger.debug(`ComicVine: issue ${issue.id} has no credits from list endpoint, fetching detail`);
    const detailed = signal
      ? await this.client.getIssueById(String(issue.id), apiKey, signal)
      : await this.client.getIssueById(String(issue.id), apiKey);
    return detailed ?? issue;
  }
}
