import { Injectable } from '@nestjs/common';

import type * as schema from '../../../db/schema';
import { MigrationRepository } from '../migration.repository';
import { MigrationImportRepository } from './migration-import.repository';
import type { PlannerResult } from '../planner/planner.types';
import { type RunStateCheck, buildContributorValues, buildMetadataPatch, emptyCounters, getSourceContributors, truncateText } from './executor-utils';

function isDomainAvailable(planned: PlannerResult, domain: keyof NonNullable<PlannerResult['execution']['sourceData']['availableDomains']>): boolean {
  return planned.execution.sourceData.availableDomains?.[domain] ?? true;
}

@Injectable()
export class SharedOverlaysImporter {
  constructor(
    private readonly repo: MigrationRepository,
    private readonly importRepo: MigrationImportRepository,
  ) {}

  async import(runId: number, planned: PlannerResult, ensureRunning: RunStateCheck): Promise<void> {
    await this.importMetadata(runId, planned, ensureRunning);
    await this.importAuthors(runId, planned);
    await this.importNarrators(runId, planned);
    await this.importGenres(runId, planned);
    await this.importTags(runId, planned);
  }

  private async importMetadata(runId: number, planned: PlannerResult, ensureRunning: RunStateCheck): Promise<void> {
    const sourceBooksById = new Map(planned.execution.sourceData.books.map((row) => [row.sourceBookId, row]));
    const counters = emptyCounters();
    const batch: Array<{ bookId: number } & Record<string, unknown>> = [];

    if (!isDomainAvailable(planned, 'metadata')) {
      counters.processed = planned.execution.matchedBooks.length;
      counters.skipped = planned.execution.matchedBooks.length;
      await this.repo.setRunMetric(runId, 'shared_overlays', 'book_metadata', counters);
      return;
    }

    for (const match of planned.execution.matchedBooks) {
      await ensureRunning();
      counters.processed += 1;

      const sourceBook = sourceBooksById.get(match.sourceBookId);
      if (!sourceBook) {
        counters.unresolved += 1;
        continue;
      }

      const patch = buildMetadataPatch(sourceBook);
      if (Object.keys(patch).length === 0) {
        counters.skipped += 1;
        continue;
      }

      batch.push({ bookId: match.targetBookId, ...patch });
      counters.imported += 1;
    }

    await this.importRepo.withTransaction((importRepo) => importRepo.batchUpsertBookMetadata(batch));
    await this.repo.setRunMetric(runId, 'shared_overlays', 'book_metadata', counters);
  }

  private async importAuthors(runId: number, planned: PlannerResult): Promise<void> {
    const sourceBooksById = new Map(planned.execution.sourceData.books.map((b) => [b.sourceBookId, b]));
    const counters = emptyCounters();

    if (!isDomainAvailable(planned, 'authors')) {
      counters.processed = planned.execution.matchedBooks.length;
      counters.skipped = planned.execution.matchedBooks.length;
      await this.repo.setRunMetric(runId, 'shared_overlays', 'book_authors', counters);
      return;
    }

    // Collect all unique authors and per-book assignments in a single pass
    const allAuthors = new Map<string, typeof schema.authors.$inferInsert>();
    const bookAssignments: Array<{ bookId: number; authorName: string; displayOrder: number }> = [];
    const affectedBookIds: number[] = [];

    for (const match of planned.execution.matchedBooks) {
      counters.processed += 1;
      const sourceBook = sourceBooksById.get(match.sourceBookId);
      if (!sourceBook) {
        counters.unresolved += 1;
        continue;
      }

      affectedBookIds.push(match.targetBookId);
      const authors = getSourceContributors(sourceBook.authors, sourceBook.author);
      if (authors.length === 0) {
        counters.skipped += 1;
        continue;
      }

      for (const [index, contributor] of authors.entries()) {
        const values = buildContributorValues(contributor);
        allAuthors.set(values.name, values);
        bookAssignments.push({ bookId: match.targetBookId, authorName: values.name, displayOrder: index });
      }
      counters.imported += authors.length;
    }

    await this.importRepo.withTransaction(async (importRepo) => {
      await importRepo.batchDeleteBookAuthors(affectedBookIds);
      const nameToId = await importRepo.batchUpsertAuthors([...allAuthors.values()]);
      const links = bookAssignments
        .map((a) => ({ bookId: a.bookId, authorId: nameToId.get(a.authorName)!, displayOrder: a.displayOrder }))
        .filter((a) => a.authorId != null);
      await importRepo.batchInsertBookAuthors(links);
    });

    await this.repo.setRunMetric(runId, 'shared_overlays', 'book_authors', counters);
  }

  private async importNarrators(runId: number, planned: PlannerResult): Promise<void> {
    const sourceBooksById = new Map(planned.execution.sourceData.books.map((b) => [b.sourceBookId, b]));
    const counters = emptyCounters();

    if (!isDomainAvailable(planned, 'narrators')) {
      counters.processed = planned.execution.matchedBooks.length;
      counters.skipped = planned.execution.matchedBooks.length;
      await this.repo.setRunMetric(runId, 'shared_overlays', 'book_narrators', counters);
      return;
    }

    const allNarrators = new Map<string, { name: string; sortName: string }>();
    const bookAssignments: Array<{ bookId: number; narratorName: string; displayOrder: number }> = [];
    const affectedBookIds: number[] = [];

    for (const match of planned.execution.matchedBooks) {
      counters.processed += 1;
      const sourceBook = sourceBooksById.get(match.sourceBookId);
      if (!sourceBook) {
        counters.unresolved += 1;
        continue;
      }

      affectedBookIds.push(match.targetBookId);
      const narrators = getSourceContributors(sourceBook.narrators, null);
      if (narrators.length === 0) {
        counters.skipped += 1;
        continue;
      }

      for (const [index, contributor] of narrators.entries()) {
        const values = {
          name: truncateText(contributor.name, 500),
          sortName: truncateText(contributor.sortName ?? contributor.name, 500),
        };
        allNarrators.set(values.name, values);
        bookAssignments.push({ bookId: match.targetBookId, narratorName: values.name, displayOrder: index });
      }
      counters.imported += narrators.length;
    }

    await this.importRepo.withTransaction(async (importRepo) => {
      await importRepo.batchDeleteBookNarrators(affectedBookIds);
      const nameToId = await importRepo.batchUpsertNarrators([...allNarrators.values()]);
      const links = bookAssignments
        .map((a) => ({ bookId: a.bookId, narratorId: nameToId.get(a.narratorName)!, displayOrder: a.displayOrder }))
        .filter((a) => a.narratorId != null);
      await importRepo.batchInsertBookNarrators(links);
    });

    await this.repo.setRunMetric(runId, 'shared_overlays', 'book_narrators', counters);
  }

  private async importGenres(runId: number, planned: PlannerResult): Promise<void> {
    const sourceBooksById = new Map(planned.execution.sourceData.books.map((b) => [b.sourceBookId, b]));
    const counters = emptyCounters();

    if (!isDomainAvailable(planned, 'genres')) {
      counters.processed = planned.execution.matchedBooks.length;
      counters.skipped = planned.execution.matchedBooks.length;
      await this.repo.setRunMetric(runId, 'shared_overlays', 'book_genres', counters);
      return;
    }

    const allGenreNames = new Set<string>();
    const bookAssignments: Array<{ bookId: number; genreName: string }> = [];
    const affectedBookIds: number[] = [];

    for (const match of planned.execution.matchedBooks) {
      counters.processed += 1;
      const sourceBook = sourceBooksById.get(match.sourceBookId);
      if (!sourceBook) {
        counters.unresolved += 1;
        continue;
      }

      affectedBookIds.push(match.targetBookId);
      if (sourceBook.genres.length === 0) {
        counters.skipped += 1;
        continue;
      }

      for (const name of sourceBook.genres) {
        const genreName = truncateText(name, 200);
        allGenreNames.add(genreName);
        bookAssignments.push({ bookId: match.targetBookId, genreName });
      }
      counters.imported += sourceBook.genres.length;
    }

    await this.importRepo.withTransaction(async (importRepo) => {
      await importRepo.batchDeleteBookGenres(affectedBookIds);
      const nameToId = await importRepo.batchUpsertGenres([...allGenreNames]);
      const links = bookAssignments.map((a) => ({ bookId: a.bookId, genreId: nameToId.get(a.genreName)! })).filter((a) => a.genreId != null);
      await importRepo.batchInsertBookGenres(links);
    });

    await this.repo.setRunMetric(runId, 'shared_overlays', 'book_genres', counters);
  }

  private async importTags(runId: number, planned: PlannerResult): Promise<void> {
    const sourceBooksById = new Map(planned.execution.sourceData.books.map((b) => [b.sourceBookId, b]));
    const counters = emptyCounters();

    if (!isDomainAvailable(planned, 'tags')) {
      counters.processed = planned.execution.matchedBooks.length;
      counters.skipped = planned.execution.matchedBooks.length;
      await this.repo.setRunMetric(runId, 'shared_overlays', 'book_tags', counters);
      return;
    }

    const allTagNames = new Set<string>();
    const bookAssignments: Array<{ bookId: number; tagName: string }> = [];
    const affectedBookIds: number[] = [];

    for (const match of planned.execution.matchedBooks) {
      counters.processed += 1;
      const sourceBook = sourceBooksById.get(match.sourceBookId);
      if (!sourceBook) {
        counters.unresolved += 1;
        continue;
      }

      affectedBookIds.push(match.targetBookId);
      if (sourceBook.tags.length === 0) {
        counters.skipped += 1;
        continue;
      }

      for (const name of sourceBook.tags) {
        const tagName = truncateText(name, 200);
        allTagNames.add(tagName);
        bookAssignments.push({ bookId: match.targetBookId, tagName });
      }
      counters.imported += sourceBook.tags.length;
    }

    await this.importRepo.withTransaction(async (importRepo) => {
      await importRepo.batchDeleteBookTags(affectedBookIds);
      const nameToId = await importRepo.batchUpsertTags([...allTagNames]);
      const links = bookAssignments.map((a) => ({ bookId: a.bookId, tagId: nameToId.get(a.tagName)! })).filter((a) => a.tagId != null);
      await importRepo.batchInsertBookTags(links);
    });

    await this.repo.setRunMetric(runId, 'shared_overlays', 'book_tags', counters);
  }
}
