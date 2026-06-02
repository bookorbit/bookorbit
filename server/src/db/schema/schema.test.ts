import { bookMetadata } from './metadata';
import { bookSeries } from './series';
import { users, appSettings } from './auth';
import { opdsUsers } from './opds';
import { bookDockFiles } from './book-dock';
import { libraries } from './libraries';
import { books, bookFiles } from './books';
import { emailProviders } from './email-providers';
import { emailTemplates } from './email-templates';
import { collections } from './collections';
import { emailPreferences } from './email-preferences';
import { smartScopes } from './smart-scopes';
import { koboSyncSettings, koboLibrarySnapshots, koboReadingStates } from './kobo';
import { emailRecipients, emailRecipientGroups } from './email-recipients';
import { readerDefaultPreferences, readerPreferences, readingProgress, annotations, userReadingDailyStats } from './reader';
import { migrationSources, migrationProfiles, migrationPlanArtifacts, migrationRuns, migrationRunMetrics } from './migration';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { FILE_ROLES } from '../../modules/scanner/lib/classify';

describe('Database Schema Logic', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  describe('Metadata Schema - embedding256 custom type', () => {
    const embeddingColumn = bookMetadata.embedding;

    it('toDriver should format array as a vector string', () => {
      const input = [0.1, 0.2, 0.3];
      const result = embeddingColumn.mapToDriverValue(input);
      expect(result).toBe('[0.1,0.2,0.3]');
    });

    it('fromDriver should parse vector string to array', () => {
      const input = '[0.1,0.2,0.3]';
      const result = embeddingColumn.mapFromDriverValue(input);
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    it('fromDriver should handle empty vector string safely', () => {
      const input = '[]';
      const result = embeddingColumn.mapFromDriverValue(input);
      expect(result).toEqual([]);
    });

    it('fromDriver should handle null/undefined safely', () => {
      // @ts-expect-error: testing invalid null input
      expect(embeddingColumn.mapFromDriverValue(null)).toEqual([]);
      // @ts-expect-error: testing invalid undefined input
      expect(embeddingColumn.mapFromDriverValue(undefined)).toEqual([]);
    });

    it('fromDriver should handle non-string inputs safely', () => {
      // @ts-expect-error: testing invalid number input
      expect(embeddingColumn.mapFromDriverValue(123)).toEqual([]);
      // @ts-expect-error: testing invalid object input
      expect(embeddingColumn.mapFromDriverValue({})).toEqual([]);
    });
  });

  describe('onUpdateFn presence', () => {
    const hasOnUpdateFn = (column: any) => {
      return typeof column.onUpdateFn === 'function';
    };

    const testOnUpdate = (name: string, column: any) => {
      it(`${name} should have an onUpdateFn returning the current Date`, () => {
        expect(hasOnUpdateFn(column)).toBe(true);
        const result = column.onUpdateFn?.();
        expect(result).toBeInstanceOf(Date);
        expect(result).toEqual(new Date('2024-01-01T00:00:00Z'));
      });
    };

    testOnUpdate('users.updatedAt', users.updatedAt);
    testOnUpdate('appSettings.updatedAt', appSettings.updatedAt);
    testOnUpdate('opdsUsers.updatedAt', opdsUsers.updatedAt);
    testOnUpdate('bookDockFiles.updatedAt', bookDockFiles.updatedAt);
    testOnUpdate('libraries.updatedAt', libraries.updatedAt);
    testOnUpdate('books.updatedAt', books.updatedAt);
    testOnUpdate('bookFiles.updatedAt', bookFiles.updatedAt);
    testOnUpdate('bookMetadata.updatedAt', bookMetadata.updatedAt);
    testOnUpdate('bookSeries.updatedAt', bookSeries.updatedAt);
    testOnUpdate('emailProviders.updatedAt', emailProviders.updatedAt);
    testOnUpdate('emailTemplates.updatedAt', emailTemplates.updatedAt);
    testOnUpdate('collections.updatedAt', collections.updatedAt);
    testOnUpdate('emailPreferences.updatedAt', emailPreferences.updatedAt);
    testOnUpdate('smartScopes.updatedAt', smartScopes.updatedAt);
    testOnUpdate('koboSyncSettings.updatedAt', koboSyncSettings.updatedAt);
    testOnUpdate('koboLibrarySnapshots.updatedAt', koboLibrarySnapshots.updatedAt);
    testOnUpdate('koboReadingStates.updatedAt', koboReadingStates.updatedAt);
    testOnUpdate('emailRecipients.updatedAt', emailRecipients.updatedAt);
    testOnUpdate('emailRecipientGroups.updatedAt', emailRecipientGroups.updatedAt);
    testOnUpdate('readingProgress.updatedAt', readingProgress.updatedAt);
    testOnUpdate('userReadingDailyStats.updatedAt', userReadingDailyStats.updatedAt);
    testOnUpdate('annotations.updatedAt', annotations.updatedAt);
    testOnUpdate('readerDefaultPreferences.updatedAt', readerDefaultPreferences.updatedAt);
    testOnUpdate('readerPreferences.updatedAt', readerPreferences.updatedAt);
    testOnUpdate('migrationSources.updatedAt', migrationSources.updatedAt);
    testOnUpdate('migrationProfiles.updatedAt', migrationProfiles.updatedAt);
    testOnUpdate('migrationPlanArtifacts.updatedAt', migrationPlanArtifacts.updatedAt);
    testOnUpdate('migrationRuns.updatedAt', migrationRuns.updatedAt);
    testOnUpdate('migrationRunMetrics.updatedAt', migrationRunMetrics.updatedAt);
  });

  describe('book_files role constraint', () => {
    it('book_files_role_chk exists and covers every FILE_ROLES value', () => {
      const config = getTableConfig(bookFiles);
      const roleCheck = config.checks.find((c) => c.name === 'book_files_role_chk');
      expect(roleCheck).toBeDefined();

      // Drizzle SQL queryChunks are StringChunk objects ({ value: string[] }) or Column references.
      // Join all string portions to get the constraint SQL text.
      const constraintSql = roleCheck!.value.queryChunks.map((chunk: any) => (Array.isArray(chunk?.value) ? chunk.value.join('') : '')).join('');

      for (const role of FILE_ROLES) {
        expect(constraintSql).toContain(`'${role}'`);
      }
    });

    it('role column default is a valid FILE_ROLES member', () => {
      expect(FILE_ROLES as readonly string[]).toContain(bookFiles.role.default);
    });
  });
});
