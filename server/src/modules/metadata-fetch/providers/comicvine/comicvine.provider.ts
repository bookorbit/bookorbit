import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey, parseSeriesIndex } from '@bookorbit/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { ProviderThrottleTracker } from '../../provider-throttle.tracker';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { IdentifiableProvider } from '../metadata-provider';
import { MetadataSearchParams } from '../metadata-search-params';
import { PROVIDER_BUDGETS_MS, PROVIDER_LIMITS } from '../provider-constants';
import { createSearchDeadline, normalizeMaxCandidates, SearchDeadline } from '../provider-utils';
import { ComicVineClient } from './comicvine.client';
import { mapIssueToCandidate } from './comicvine.mapper';
import { normalizeIssueNumber, rankVolumes } from './comicvine.matching';
import { ComicVineIssue, ComicVineVolume } from './comicvine.types';

const ISSUE_PATTERN = /^(.*?)\s*#(\d[\d.]*)(.*)$/;

// Every ComicVine call costs a rate-limiter slot, and the volume issue list is slow enough that
// probing candidates one at a time exhausts the provider budget before reaching the right run.
// Probing a wave at a time keeps recall across all VOLUME_PROBE_LIMIT candidates affordable.
const VOLUME_PROBE_LIMIT = 8;
const VOLUME_PROBE_BATCH = 3;

interface ParsedIssueTitle {
  seriesName: string;
  issueNumber: string;
}

interface VolumeIssueMatch {
  issue: ComicVineIssue;
  volume?: ComicVineVolume;
}

interface VolumeEnrichmentResult {
  matches: VolumeIssueMatch[];
  stopped: boolean;
}

function parseIssueTitle(title: string): ParsedIssueTitle | null {
  const match = ISSUE_PATTERN.exec(title.trim());
  if (!match) return null;
  const seriesName = match[1].trim();
  const issueNumber = normalizeIssueNumber(match[2]);
  if (!seriesName || !issueNumber) return null;
  return { seriesName, issueNumber };
}

function storedIssueNumber(params: MetadataSearchParams): string | null {
  return parseSeriesIndex(params.seriesIndex);
}

/**
 * Prefer a "<series> #<issue>" title because that is the user naming an explicit target. Otherwise
 * the stored series leads, since a comic title holds only the issue name and without that fallback
 * an already-matched comic would re-search through the far looser general issue search.
 *
 * A typed query that is not the book's own title overrides the stored series name even so, or
 * searching a comic for a different series would silently return the series it is already filed
 * under. The stored issue number still applies: it is the one thing a bare series query omits.
 */
function resolveIssueQuery(params: MetadataSearchParams): ParsedIssueTitle | null {
  const fromTitle = params.title ? parseIssueTitle(params.title) : null;
  if (fromTitle) return fromTitle;

  const issueNumber = storedIssueNumber(params);
  const typedSeriesName = params.titleIsExplicitQuery ? params.title?.trim() : undefined;
  if (typedSeriesName) return issueNumber ? { seriesName: typedSeriesName, issueNumber } : null;

  const seriesName = params.seriesName?.trim();
  if (!seriesName || !issueNumber) return null;
  return { seriesName, issueNumber };
}

function isThrottleRejection(result: PromiseSettledResult<unknown>): boolean {
  return result.status === 'rejected' && result.reason instanceof ProviderThrottleError;
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

function isValidVolumeId(volumeId: number): boolean {
  return Number.isSafeInteger(volumeId) && volumeId > 0;
}

@Injectable()
export class ComicVineProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.COMICVINE;
  readonly label = 'ComicVine';
  readonly identifiable = true as const;
  readonly mediaKinds = ['comic'] as const;

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
      const parsed = resolveIssueQuery(params);
      const deadline = createSearchDeadline(PROVIDER_BUDGETS_MS.COMICVINE_SEARCH, params.signal);

      try {
        const matches = parsed
          ? await this.structuredSearch(parsed.seriesName, parsed.issueNumber, apiKey, maxCandidates, deadline)
          : await this.generalSearch(params.title, apiKey, maxCandidates, deadline);

        const volumeEnrichment = await this.enrichVolumesWithinBudget(matches, apiKey, deadline);
        const enriched = volumeEnrichment.stopped
          ? volumeEnrichment.matches
          : await this.enrichIssueDetailsWithinBudget(volumeEnrichment.matches, apiKey, deadline);
        return enriched.map(({ issue, volume }) => mapIssueToCandidate(issue, { volume }));
      } finally {
        deadline.dispose();
      }
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
      if (!issue) return null;
      if (!isValidVolumeId(issue.volume.id)) return mapIssueToCandidate(issue);

      try {
        const volume = signal
          ? await this.client.getVolumeById(issue.volume.id, apiKey, signal)
          : await this.client.getVolumeById(issue.volume.id, apiKey);
        return mapIssueToCandidate(issue, { volume: volume ?? undefined });
      } catch (err) {
        if (err instanceof ProviderThrottleError) {
          this.recordThrottle();
          return mapIssueToCandidate(issue);
        }
        throw err;
      }
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
    deadline: SearchDeadline,
  ): Promise<VolumeIssueMatch[]> {
    const volumes = await this.client.searchVolumes(seriesName, apiKey, deadline.signal);
    if (volumes.length === 0) {
      this.logger.debug(`ComicVine: no volumes found for "${seriesName}"`);
      return [];
    }

    const ranked = rankVolumes(volumes, seriesName, issueNumber).slice(0, VOLUME_PROBE_LIMIT);
    const matches: VolumeIssueMatch[] = [];
    const seenIssueIds = new Set<number>();

    for (let offset = 0; offset < ranked.length; offset += VOLUME_PROBE_BATCH) {
      const wave = ranked.slice(offset, offset + VOLUME_PROBE_BATCH);
      // Settled rather than all: one probe being throttled or cut off by the deadline must not
      // discard the issues its siblings found.
      const probed = await Promise.allSettled(wave.map((volume) => this.probeVolume(volume, issueNumber, apiKey, deadline.signal)));

      for (const result of probed) {
        if (result.status !== 'fulfilled') continue;
        for (const issue of result.value.issues) {
          if (seenIssueIds.has(issue.id)) continue;
          seenIssueIds.add(issue.id);
          matches.push({ issue, volume: result.value.volume });
        }
      }

      if (probed.some(isThrottleRejection)) {
        this.recordThrottle();
        break;
      }
      if (matches.length > 0) break;
      if (deadline.expired()) {
        this.logger.debug(`ComicVine: budget spent after ${offset + wave.length} volume probes for "${seriesName}" #${issueNumber}`);
        break;
      }
    }

    if (matches.length === 0) {
      this.logger.debug(`ComicVine: no issues found for "${seriesName}" #${issueNumber}`);
    }
    return matches.slice(0, maxCandidates);
  }

  private async probeVolume(
    volume: ComicVineVolume,
    issueNumber: string,
    apiKey: string,
    signal: AbortSignal,
  ): Promise<{ volume: ComicVineVolume; issues: ComicVineIssue[] }> {
    return { volume, issues: await this.client.searchIssuesInVolume(volume.id, issueNumber, apiKey, signal) };
  }

  private async generalSearch(query: string, apiKey: string, maxCandidates: number, deadline: SearchDeadline): Promise<VolumeIssueMatch[]> {
    const issues = await this.client.searchIssues(query, apiKey, deadline.signal);
    return issues.slice(0, maxCandidates).map((issue) => ({ issue }));
  }

  private async enrichVolumesWithinBudget(matches: VolumeIssueMatch[], apiKey: string, deadline: SearchDeadline): Promise<VolumeEnrichmentResult> {
    const enriched: VolumeIssueMatch[] = [];
    const volumes = new Map<number, ComicVineVolume | null>();
    let stopped = false;

    for (const match of matches) {
      const volumeId = match.issue.volume.id;
      if (stopped || match.volume || !isValidVolumeId(volumeId) || deadline.expired()) {
        enriched.push(match);
        continue;
      }

      if (volumes.has(volumeId)) {
        enriched.push({ ...match, volume: volumes.get(volumeId) ?? undefined });
        continue;
      }

      try {
        const volume = await this.client.getVolumeById(volumeId, apiKey, deadline.signal);
        const linkedVolume = volume?.id === volumeId ? volume : null;
        volumes.set(volumeId, linkedVolume);
        enriched.push({ ...match, volume: linkedVolume ?? undefined });
      } catch (err) {
        enriched.push(match);
        stopped = true;
        if (err instanceof ProviderThrottleError) this.recordThrottle();
      }
    }

    return { matches: enriched, stopped };
  }

  /**
   * Detail lookups only add credits, so they are worth a request each only after volume fields have
   * been filled and while the budget holds.
   * Sequential because the client serializes calls anyway, which lets the deadline actually stop
   * the work rather than every lookup being queued up front. A lookup that fails or is cut off
   * costs its candidate only the credits, never the candidate itself.
   */
  private async enrichIssueDetailsWithinBudget(matches: VolumeIssueMatch[], apiKey: string, deadline: SearchDeadline): Promise<VolumeIssueMatch[]> {
    const enriched: VolumeIssueMatch[] = [];
    let stopped = false;

    for (const match of matches) {
      if (stopped || hasAnyCredits(match.issue) || deadline.expired()) {
        enriched.push(match);
        continue;
      }

      this.logger.debug(`ComicVine: issue ${match.issue.id} has no credits from list endpoint, fetching detail`);
      try {
        const detailed = await this.client.getIssueById(String(match.issue.id), apiKey, deadline.signal);
        enriched.push(detailed ? { ...match, issue: detailed } : match);
      } catch (err) {
        enriched.push(match);
        stopped = true;
        if (err instanceof ProviderThrottleError) this.recordThrottle();
      }
    }

    return enriched;
  }
}
