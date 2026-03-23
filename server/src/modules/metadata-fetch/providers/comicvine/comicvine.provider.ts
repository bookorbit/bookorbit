import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@projectx/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { IdentifiableProvider } from '../metadata-provider';
import { MetadataSearchParams } from '../metadata-search-params';
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
  ) {}

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const { enabled, apiKey } = await this.providerConfig.getConfig().then((c) => c.comicvine);
    if (!enabled || !apiKey) {
      this.logger.debug(`ComicVine skipped: enabled=${enabled} hasApiKey=${!!apiKey}`);
      return [];
    }
    if (!params.title) return [];

    const parsed = parseIssueTitle(params.title);
    if (parsed) {
      return this.structuredSearch(parsed.seriesName, parsed.issueNumber, apiKey);
    }

    return this.generalSearch(params.title, apiKey);
  }

  async lookupById(providerId: string): Promise<MetadataCandidate | null> {
    const { enabled, apiKey } = await this.providerConfig.getConfig().then((c) => c.comicvine);
    if (!enabled || !apiKey) return null;

    const issue = await this.client.getIssueById(providerId, apiKey);
    if (!issue) return null;

    return mapIssueToCandidate(issue);
  }

  private async structuredSearch(seriesName: string, issueNumber: string, apiKey: string): Promise<MetadataCandidate[]> {
    const volumes = await this.client.searchVolumes(seriesName, apiKey);
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
      const issues = await this.client.searchIssuesInVolume(volume.id, issueNumber, apiKey);
      if (issues.length > 0) {
        const enriched = await Promise.all(issues.map((issue) => this.enrichWithDetails(issue, apiKey)));
        return enriched.map(mapIssueToCandidate);
      }
    }

    this.logger.debug(`ComicVine: no issues found for "${seriesName}" #${issueNumber}`);
    return [];
  }

  private async generalSearch(query: string, apiKey: string): Promise<MetadataCandidate[]> {
    const issues = await this.client.searchIssues(query, apiKey);
    const enriched = await Promise.all(issues.map((issue) => this.enrichWithDetails(issue, apiKey)));
    return enriched.map(mapIssueToCandidate);
  }

  private async enrichWithDetails(issue: ComicVineIssue, apiKey: string): Promise<ComicVineIssue> {
    if (hasAnyCredits(issue)) return issue;
    this.logger.debug(`ComicVine: issue ${issue.id} has no credits from list endpoint, fetching detail`);
    const detailed = await this.client.getIssueById(String(issue.id), apiKey);
    return detailed ?? issue;
  }
}
