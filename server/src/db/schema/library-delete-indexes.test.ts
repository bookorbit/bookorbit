import { getTableConfig } from 'drizzle-orm/pg-core';

import { bookDockFiles } from './book-dock';
import { emailSendLog } from './email-send-log';
import { fileWriteLog } from './file-write';
import { hardcoverBookState } from './hardcover';
import { koboLegacySnapshotBooks, koboReadingStates, koboSnapshotBooks } from './kobo';
import { koreaderPageStats } from './koreader';
import {
  annotationPositions,
  annotations,
  audiobookProgress,
  bookmarks,
  readerPreferences,
  readingAttempts,
  readingSessions,
  userReadingDailyStats,
} from './reader';
import { storygraphBookState } from './storygraph';

const cascadeIndexCases = [
  ['book dock target library', bookDockFiles, ['target_library_id']],
  ['email log book', emailSendLog, ['book_id']],
  ['email log book file', emailSendLog, ['book_file_id']],
  ['file write log book file', fileWriteLog, ['book_file_id']],
  ['Hardcover state book', hardcoverBookState, ['book_id']],
  ['legacy Kobo snapshot book', koboLegacySnapshotBooks, ['book_id']],
  ['Kobo device snapshot book', koboSnapshotBooks, ['book_id']],
  ['Kobo reading state book', koboReadingStates, ['book_id']],
  ['KOReader page stats book file', koreaderPageStats, ['book_file_id']],
  ['reading attempt book', readingAttempts, ['book_id']],
  ['reading session book', readingSessions, ['book_id']],
  ['daily reading statistics library', userReadingDailyStats, ['library_id']],
  ['audiobook progress book', audiobookProgress, ['book_id']],
  ['audiobook progress current file', audiobookProgress, ['current_file_id']],
  ['bookmark book', bookmarks, ['book_id']],
  ['annotation book', annotations, ['book_id']],
  ['annotation position book file', annotationPositions, ['book_file_id']],
  ['reader preferences book file', readerPreferences, ['book_file_id']],
  ['StoryGraph state book', storygraphBookState, ['book_id']],
] as const;

describe('library deletion cascade indexes', () => {
  it.each(cascadeIndexCases)('indexes the %s foreign key with the referenced column first', (_label, table, expectedColumns) => {
    const config = getTableConfig(table as never);
    const foreignKeyColumns = config.foreignKeys.map((foreignKey) => foreignKey.reference().columns.map((column) => column.name));
    const leadingIndexColumns = config.indexes.map((tableIndex) =>
      tableIndex.config.columns.slice(0, expectedColumns.length).map((column) => column.name),
    );

    expect(foreignKeyColumns).toContainEqual([...expectedColumns]);
    expect(leadingIndexColumns).toContainEqual([...expectedColumns]);
  });
});
