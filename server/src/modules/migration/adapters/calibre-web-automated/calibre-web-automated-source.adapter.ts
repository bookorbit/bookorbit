import { Injectable } from '@nestjs/common';

import type { SourceAdapter, SourceExportData, SourceSnapshot, SourceValidationResult } from '../source-adapter.types';
import type { CalibreWebAutomatedConnectionConfig } from './calibre-web-automated-connection-config';
import { CalibreWebAutomatedNormalizer } from './calibre-web-automated-normalizer';
import { CalibreWebAutomatedSnapshotConnector } from './calibre-web-automated-snapshot.connector';
import type { CalibreWebAutomatedNormalizationResult } from './calibre-web-automated-source.types';

@Injectable()
export class CalibreWebAutomatedSourceAdapter implements SourceAdapter<CalibreWebAutomatedConnectionConfig> {
  readonly type = 'calibre_web_automated';

  constructor(
    private readonly connector: CalibreWebAutomatedSnapshotConnector,
    private readonly normalizer: CalibreWebAutomatedNormalizer,
  ) {}

  async validate(config: CalibreWebAutomatedConnectionConfig): Promise<SourceValidationResult> {
    const normalized = await this.fetchNormalized(config);
    return {
      ok: true,
      sourceType: this.type,
      sourceVersion: normalized.sourceVersion,
      missingTables: [],
      warnings: normalized.warnings,
      counts: buildCounts(normalized),
    };
  }

  async snapshot(config: CalibreWebAutomatedConnectionConfig): Promise<SourceSnapshot> {
    const normalized = await this.fetchNormalized(config);
    return {
      generatedAt: new Date().toISOString(),
      sourceType: this.type,
      sourceVersion: normalized.sourceVersion,
      counts: buildCounts(normalized),
    };
  }

  async exportData(config: CalibreWebAutomatedConnectionConfig): Promise<SourceExportData> {
    return (await this.fetchNormalized(config)).data;
  }

  async fetchPathPrefixes(config: CalibreWebAutomatedConnectionConfig): Promise<string[]> {
    return (await this.fetchNormalized(config)).pathPrefixes;
  }

  private async fetchNormalized(config: CalibreWebAutomatedConnectionConfig): Promise<CalibreWebAutomatedNormalizationResult> {
    return this.normalizer.normalize(await this.connector.fetchSourceRecords(config));
  }
}

function buildCounts(normalized: CalibreWebAutomatedNormalizationResult): Record<string, number> {
  const { data } = normalized;
  return {
    users: data.users.length,
    books: data.books.length,
    files: data.books.reduce((total, book) => total + (book.files?.length ?? 0), 0),
    userBookStatuses: data.userBookStatuses.length,
    userFileProgress: data.userFileProgress.length,
    shelves: data.shelves.length,
    shelfBooks: data.shelfBooks.length,
  };
}
