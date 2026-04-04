import { Injectable } from '@nestjs/common';
import type mysql from 'mysql2/promise';

import type {
  SourceAdapter,
  SourceAnnotation,
  SourceBook,
  SourceBookmark,
  SourceContributor,
  SourceExportData,
  SourceShelf,
  SourceShelfBook,
  SourceSnapshot,
  SourceUser,
  SourceUserBookStatus,
  SourceUserFileProgress,
  SourceValidationResult,
} from '../source-adapter.types';
import type { BookloreConnectionConfig } from './booklore-connection-config';
import { BookloreConnector } from './booklore-connector';

const TABLE_CANDIDATES = {
  users: ['users'],
  book: ['book', 'books'],
  bookFile: ['book_file', 'book_files'],
  bookMetadata: ['book_metadata'],
  libraryPath: ['library_path', 'library_paths'],
  authors: ['author', 'authors'],
  authorMapping: ['book_metadata_author_mapping', 'book_author_mapping'],
  userBookProgress: ['user_book_progress'],
  userBookFileProgress: ['user_book_file_progress'],
  bookmarks: ['book_marks', 'bookmarks'],
  annotations: ['annotations'],
  pdfAnnotations: ['pdf_annotations'],
  shelves: ['shelf', 'shelves'],
  shelfBooks: ['book_shelf_mapping', 'shelf_book_mapping'],
  categories: ['category', 'categories', 'genre', 'genres'],
  categoryMapping: ['book_metadata_category_mapping', 'book_category_mapping', 'book_genre_mapping'],
  tags: ['tag', 'tags'],
  tagMapping: ['book_metadata_tag_mapping', 'book_tag_mapping'],
  bookNotes: ['book_notes'],
  bookNotesV2: ['book_notes_v2'],
  epubViewerPreference: ['epub_viewer_preference'],
  pdfViewerPreference: ['pdf_viewer_preference'],
  cbxViewerPreference: ['cbx_viewer_preference'],
  newPdfViewerPreference: ['new_pdf_viewer_preference'],
  koboUserSettings: ['kobo_user_settings'],
  koboReadingState: ['kobo_reading_state'],
  comicMetadata: ['comic_metadata'],
} as const;

interface TableResolution {
  users: string | null;
  book: string | null;
  bookFile: string | null;
  bookMetadata: string | null;
  libraryPath: string | null;
  authors: string | null;
  authorMapping: string | null;
  userBookProgress: string | null;
  userBookFileProgress: string | null;
  bookmarks: string | null;
  annotations: string | null;
  pdfAnnotations: string | null;
  shelves: string | null;
  shelfBooks: string | null;
  categories: string | null;
  categoryMapping: string | null;
  tags: string | null;
  tagMapping: string | null;
  bookNotes: string | null;
  bookNotesV2: string | null;
  epubViewerPreference: string | null;
  pdfViewerPreference: string | null;
  cbxViewerPreference: string | null;
  newPdfViewerPreference: string | null;
  koboUserSettings: string | null;
  koboReadingState: string | null;
  comicMetadata: string | null;
}

@Injectable()
export class BookloreSourceAdapter implements SourceAdapter<BookloreConnectionConfig> {
  readonly type = 'booklore';

  constructor(private readonly connector: BookloreConnector) {}

  async validate(config: BookloreConnectionConfig): Promise<SourceValidationResult> {
    return this.connector.withConnection(config, async (conn) => {
      const tables = await this.connector.listTables(conn);
      const resolved = resolveTables(tables);
      const sourceVersion = await this.readVersion(conn);

      const missingTables: string[] = [];
      if (!resolved.users) missingTables.push('users');
      if (!resolved.book) missingTables.push('book');
      if (!resolved.bookFile) missingTables.push('book_file');

      const counts = await this.collectCounts(conn, resolved);
      const warnings = this.buildWarnings(resolved, config);

      return {
        ok: missingTables.length === 0,
        sourceType: this.type,
        sourceVersion,
        missingTables,
        warnings,
        counts,
      };
    });
  }

  async snapshot(config: BookloreConnectionConfig): Promise<SourceSnapshot> {
    return this.connector.withConnection(config, async (conn) => {
      const tables = await this.connector.listTables(conn);
      const resolved = resolveTables(tables);
      const counts = await this.collectCounts(conn, resolved);

      return {
        generatedAt: new Date().toISOString(),
        sourceType: this.type,
        sourceVersion: await this.readVersion(conn),
        counts,
      };
    });
  }

  async exportData(config: BookloreConnectionConfig): Promise<SourceExportData> {
    return this.connector.withConnection(config, async (conn) => {
      const tables = await this.connector.listTables(conn);
      const resolved = resolveTables(tables);

      const users = await this.fetchUsers(conn, resolved.users);
      const books = await this.fetchBooks(conn, resolved);
      const userBookStatuses = await this.fetchUserBookStatuses(conn, resolved.userBookProgress);
      const userFileProgress = await this.fetchUserFileProgress(conn, resolved.userBookFileProgress, resolved.bookFile);
      const bookmarks = await this.fetchBookmarks(conn, resolved.bookmarks);
      const annotations = await this.fetchAnnotations(conn, resolved.annotations);
      const { shelves, shelfBooks } = await this.fetchShelves(conn, resolved.shelves, resolved.shelfBooks, resolved.book);
      await this.attachCategoriesToBooks(conn, books, resolved.categories, resolved.categoryMapping);
      await this.attachTagsToBooks(conn, books, resolved.tags, resolved.tagMapping);

      return {
        users,
        books,
        userBookStatuses,
        userFileProgress,
        bookmarks,
        annotations,
        shelves,
        shelfBooks,
      };
    });
  }

  async fetchPathPrefixes(config: BookloreConnectionConfig): Promise<string[]> {
    return this.connector.withConnection(config, async (conn) => {
      const tables = await this.connector.listTables(conn);
      if (!tables.has('library_path')) return [];

      const rows = await this.connector.queryRows(
        conn,
        'SELECT DISTINCT CAST(`path` AS CHAR) AS path FROM `library_path` WHERE `path` IS NOT NULL ORDER BY `path`',
      );

      return rows.map((row) => asString(row.path)).filter((p): p is string => p !== null);
    });
  }

  private async readVersion(conn: mysql.Connection): Promise<string | null> {
    try {
      const rows = await this.connector.queryRows(conn, 'SELECT VERSION() AS version');
      const value = rows[0]?.version;
      return typeof value === 'string' ? value : value == null ? null : String(value);
    } catch {
      return null;
    }
  }

  private async collectCounts(conn: mysql.Connection, resolved: TableResolution): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const [label, tableName] of Object.entries(resolved)) {
      if (!tableName) continue;
      out[label] = await this.connector.countRows(conn, tableName);
    }
    return out;
  }

  private buildWarnings(resolved: TableResolution, config: BookloreConnectionConfig): string[] {
    const warnings: string[] = [];

    if (!resolved.bookMetadata) warnings.push('book_metadata table not found; metadata overlays will be limited');
    if (!resolved.authors || !resolved.authorMapping) warnings.push('author mapping tables not found; author migration disabled');
    if (!resolved.userBookProgress) warnings.push('user_book_progress table not found; status migration disabled');
    if (!resolved.userBookFileProgress) warnings.push('user_book_file_progress table not found; file progress migration disabled');
    if (!resolved.bookmarks) warnings.push('book_marks/bookmarks table not found; bookmark migration disabled');
    if (!resolved.annotations) warnings.push('annotations table not found; annotation migration disabled');
    if (!resolved.shelves || !resolved.shelfBooks) warnings.push('shelf mapping tables not found; shelf-to-collection migration disabled');
    if (!resolved.categories || !resolved.categoryMapping) warnings.push('category/genre tables not found; genre migration disabled');
    if (!resolved.tags || !resolved.tagMapping) warnings.push('tag tables not found; tag migration disabled');
    if (resolved.pdfAnnotations) warnings.push('pdf_annotations table detected; PDF annotation migration is deferred');
    if (resolved.bookNotes || resolved.bookNotesV2) warnings.push('Booklore notes tables detected; notes migration is deferred');
    if (resolved.koboUserSettings || resolved.koboReadingState) warnings.push('Booklore Kobo tables detected; Kobo migration is deferred');
    if (resolved.comicMetadata) warnings.push('comic_metadata table detected; comic metadata migration is deferred');
    if (resolved.epubViewerPreference || resolved.pdfViewerPreference || resolved.cbxViewerPreference || resolved.newPdfViewerPreference) {
      warnings.push('Booklore viewer preference tables detected; reader preference migration is deferred');
    }
    if (!config.mediaRootPath) warnings.push('mediaRootPath not configured; book cover/thumbnail import disabled');

    return warnings;
  }

  private async fetchUsers(conn: mysql.Connection, usersTable: string | null): Promise<SourceUser[]> {
    if (!usersTable) return [];

    const columns = await this.connector.listColumns(conn, usersTable);
    const idCol = requiredColumn(columns, ['id', 'user_id']);
    const usernameCol = firstColumn(columns, ['username', 'user_name', 'name']);
    const nameCol = firstColumn(columns, ['name', 'display_name']);
    const emailCol = firstColumn(columns, ['email', 'mail']);

    const sqlText = `
      SELECT
        CAST(u.\`${idCol}\` AS CHAR) AS sourceUserId,
        ${usernameCol ? `CAST(u.\`${usernameCol}\` AS CHAR)` : `CAST(u.\`${idCol}\` AS CHAR)`} AS username,
        ${nameCol ? `CAST(u.\`${nameCol}\` AS CHAR)` : 'NULL'} AS name,
        ${emailCol ? `CAST(u.\`${emailCol}\` AS CHAR)` : 'NULL'} AS email
      FROM \`${usersTable}\` u
      ORDER BY u.\`${idCol}\`
    `;

    const rows = await this.connector.queryRows(conn, sqlText);

    return rows.map((row) => ({
      sourceUserId: asString(row.sourceUserId) ?? '',
      username: asString(row.username) ?? asString(row.sourceUserId) ?? 'unknown',
      name: asString(row.name),
      email: asString(row.email),
    }));
  }

  private async fetchBooks(conn: mysql.Connection, resolved: TableResolution): Promise<SourceBook[]> {
    const bookTable = resolved.book;
    const metadataTable = resolved.bookMetadata;
    const bookFileTable = resolved.bookFile;
    if (!bookTable) return [];

    const bookColumns = await this.connector.listColumns(conn, bookTable);
    const bookIdCol = requiredColumn(bookColumns, ['id', 'book_id']);
    const bookLibraryPathIdCol = firstColumn(bookColumns, ['library_path_id', 'librarypath_id']);

    let metadataColumns: Set<string> | null = null;
    let metadataJoinCol: string | null = null;
    if (metadataTable) {
      metadataColumns = await this.connector.listColumns(conn, metadataTable);
      metadataJoinCol = firstColumn(metadataColumns, ['book_id', 'id']);
    }

    let fileColumns: Set<string> | null = null;
    let fileJoinCol: string | null = null;
    if (bookFileTable) {
      fileColumns = await this.connector.listColumns(conn, bookFileTable);
      fileJoinCol = firstColumn(fileColumns, ['book_id', 'bookid']);
    }

    let libraryPathIdCol: string | null = null;
    let libraryPathValueCol: string | null = null;
    if (resolved.libraryPath && bookLibraryPathIdCol) {
      const libraryPathColumns = await this.connector.listColumns(conn, resolved.libraryPath);
      libraryPathIdCol = firstColumn(libraryPathColumns, ['id', 'library_path_id']);
      libraryPathValueCol = firstColumn(libraryPathColumns, ['path', 'absolute_path']);
    }

    const titleCol = metadataColumns ? firstColumn(metadataColumns, ['title']) : null;
    const authorCol = metadataColumns ? firstColumn(metadataColumns, ['author', 'authors', 'author_name']) : null;
    const subtitleCol = metadataColumns ? firstColumn(metadataColumns, ['subtitle']) : null;
    const isbn10Col = metadataColumns ? firstColumn(metadataColumns, ['isbn10', 'isbn_10']) : null;
    const isbn13Col = metadataColumns ? firstColumn(metadataColumns, ['isbn13', 'isbn_13']) : null;
    const descriptionCol = metadataColumns ? firstColumn(metadataColumns, ['description']) : null;
    const publisherCol = metadataColumns ? firstColumn(metadataColumns, ['publisher']) : null;
    const publishedYearCol = metadataColumns ? firstColumn(metadataColumns, ['published_year', 'publishedyear', 'year']) : null;
    const publishedDateCol = metadataColumns ? firstColumn(metadataColumns, ['published_date', 'publish_date', 'publication_date']) : null;
    const languageCol = metadataColumns ? firstColumn(metadataColumns, ['language', 'lang']) : null;
    const pageCountCol = metadataColumns ? firstColumn(metadataColumns, ['page_count', 'pagecount', 'pages']) : null;
    const seriesNameCol = metadataColumns ? firstColumn(metadataColumns, ['series_name', 'series']) : null;
    const seriesIndexCol = metadataColumns ? firstColumn(metadataColumns, ['series_number', 'series_index', 'series_position']) : null;
    const ratingCol = metadataColumns ? firstColumn(metadataColumns, ['rating']) : null;
    const googleBooksIdCol = metadataColumns ? firstColumn(metadataColumns, ['google_id', 'google_books_id']) : null;
    const goodreadsIdCol = metadataColumns ? firstColumn(metadataColumns, ['goodreads_id']) : null;
    const amazonIdCol = metadataColumns ? firstColumn(metadataColumns, ['asin', 'amazon_id']) : null;
    const hardcoverIdCol = metadataColumns ? firstColumn(metadataColumns, ['hardcover_id']) : null;
    const audibleIdCol = metadataColumns ? firstColumn(metadataColumns, ['audible_id']) : null;
    const comicvineIdCol = metadataColumns ? firstColumn(metadataColumns, ['comicvine_id']) : null;
    const durationSecondsCol = metadataColumns ? firstColumn(metadataColumns, ['duration_seconds', 'duration']) : null;
    const abridgedCol = metadataColumns ? firstColumn(metadataColumns, ['abridged']) : null;
    const narratorCol = metadataColumns ? firstColumn(metadataColumns, ['narrator', 'narrators']) : null;

    const fileIdCol = fileColumns ? firstColumn(fileColumns, ['id', 'book_file_id']) : null;
    const filePathCol = fileColumns ? firstColumn(fileColumns, ['absolute_path', 'path', 'file_path']) : null;
    const fileNameCol = fileColumns ? firstColumn(fileColumns, ['file_name', 'filename', 'name']) : null;
    const fileSubPathCol = fileColumns ? firstColumn(fileColumns, ['file_sub_path', 'file_subpath', 'sub_path', 'relative_path', 'rel_path']) : null;
    const currentHashCol = fileColumns ? firstColumn(fileColumns, ['current_hash', 'hash', 'file_hash', 'sha256']) : null;
    const initialHashCol = fileColumns ? firstColumn(fileColumns, ['initial_hash']) : null;
    const fileDurationSecondsCol = fileColumns ? firstColumn(fileColumns, ['duration_seconds', 'duration']) : null;

    const presentFields: string[] = (
      [
        ['title', titleCol],
        ['subtitle', subtitleCol],
        ['isbn10', isbn10Col],
        ['isbn13', isbn13Col],
        ['description', descriptionCol],
        ['publisher', publisherCol],
        ['publishedYear', publishedYearCol ?? publishedDateCol],
        ['language', languageCol],
        ['pageCount', pageCountCol],
        ['seriesName', seriesNameCol],
        ['seriesIndex', seriesIndexCol],
        ['rating', ratingCol],
        ['googleBooksId', googleBooksIdCol],
        ['goodreadsId', goodreadsIdCol],
        ['amazonId', amazonIdCol],
        ['hardcoverId', hardcoverIdCol],
        ['audibleId', audibleIdCol],
        ['comicvineId', comicvineIdCol],
        ['durationSeconds', durationSecondsCol],
        ['abridged', abridgedCol],
      ] as Array<[string, string | null]>
    )
      .filter(([, col]) => !!col)
      .map(([field]) => field);

    const selectParts = [
      `CAST(b.\`${bookIdCol}\` AS CHAR) AS sourceBookId`,
      sqlString('m', titleCol, 'title'),
      sqlString('m', authorCol, 'author'),
      sqlString('m', subtitleCol, 'subtitle'),
      sqlString('m', isbn10Col, 'isbn10'),
      sqlString('m', isbn13Col, 'isbn13'),
      sqlString('m', descriptionCol, 'description'),
      sqlString('m', publisherCol, 'publisher'),
      sqlNumber('m', publishedYearCol, 'publishedYear'),
      sqlString('m', publishedDateCol, 'publishedDate'),
      sqlString('m', languageCol, 'language'),
      sqlNumber('m', pageCountCol, 'pageCount'),
      sqlString('m', seriesNameCol, 'seriesName'),
      sqlNumber('m', seriesIndexCol, 'seriesIndex'),
      sqlNumber('m', ratingCol, 'rating'),
      sqlString('m', googleBooksIdCol, 'googleBooksId'),
      sqlString('m', goodreadsIdCol, 'goodreadsId'),
      sqlString('m', amazonIdCol, 'amazonId'),
      sqlString('m', hardcoverIdCol, 'hardcoverId'),
      sqlString('m', audibleIdCol, 'audibleId'),
      sqlString('m', comicvineIdCol, 'comicvineId'),
      sqlNumber('m', durationSecondsCol, 'durationSeconds'),
      sqlNumber('m', abridgedCol, 'abridged'),
      sqlString('m', narratorCol, 'narrator'),
      fileIdCol ? `CAST(f.\`${fileIdCol}\` AS CHAR) AS sourceFileId` : 'NULL AS sourceFileId',
      sqlString('f', filePathCol, 'directFilePath'),
      sqlString('f', fileNameCol, 'fileName'),
      sqlString('f', fileSubPathCol, 'fileSubPath'),
      sqlString('f', currentHashCol, 'currentHash'),
      sqlString('f', initialHashCol, 'initialHash'),
      sqlNumber('f', fileDurationSecondsCol, 'fileDurationSeconds'),
      libraryPathValueCol ? `CAST(lp.\`${libraryPathValueCol}\` AS CHAR) AS libraryRootPath` : 'NULL AS libraryRootPath',
    ];

    const joins: string[] = [];
    if (metadataTable && metadataJoinCol) {
      joins.push(`LEFT JOIN \`${metadataTable}\` m ON m.\`${metadataJoinCol}\` = b.\`${bookIdCol}\``);
    }
    if (bookFileTable && fileJoinCol) {
      joins.push(`LEFT JOIN \`${bookFileTable}\` f ON f.\`${fileJoinCol}\` = b.\`${bookIdCol}\``);
    }
    if (resolved.libraryPath && bookLibraryPathIdCol && libraryPathIdCol && libraryPathValueCol) {
      joins.push(`LEFT JOIN \`${resolved.libraryPath}\` lp ON lp.\`${libraryPathIdCol}\` = b.\`${bookLibraryPathIdCol}\``);
    }

    const sqlText = `
      SELECT ${selectParts.join(',\n')}
      FROM \`${bookTable}\` b
      ${joins.join('\n')}
      ORDER BY b.\`${bookIdCol}\`
    `;

    const rows = await this.connector.queryRows(conn, sqlText);
    const byBook = new Map<string, SourceBook>();

    for (const row of rows) {
      const sourceBookId = asString(row.sourceBookId);
      if (!sourceBookId) continue;

      const existing = byBook.get(sourceBookId);
      const next: SourceBook = existing ?? {
        sourceBookId,
        title: asString(row.title),
        author: asString(row.author),
        subtitle: asString(row.subtitle),
        isbn10: asString(row.isbn10),
        isbn13: asString(row.isbn13),
        description: asString(row.description),
        publisher: asString(row.publisher),
        publishedYear: asInteger(row.publishedYear) ?? parsePublishedYear(row.publishedDate),
        language: asString(row.language),
        pageCount: asInteger(row.pageCount),
        seriesName: asString(row.seriesName),
        seriesIndex: asNumber(row.seriesIndex),
        rating: asInteger(row.rating),
        googleBooksId: asString(row.googleBooksId),
        goodreadsId: asString(row.goodreadsId),
        amazonId: asString(row.amazonId),
        hardcoverId: asString(row.hardcoverId),
        audibleId: asString(row.audibleId),
        comicvineId: asString(row.comicvineId),
        durationSeconds: asInteger(row.durationSeconds),
        abridged: asBoolean(row.abridged),
        authors: [],
        narrators: parseContributorNames(asString(row.narrator)),
        filePath: null,
        fileHash: null,
        files: [],
        genres: [],
        tags: [],
        presentFields,
      };

      const sourceFileId = asString(row.sourceFileId);
      const fileName = asString(row.fileName);
      const fileSubPath = asString(row.fileSubPath);
      const filePath = buildSourceFilePath({
        directPath: asString(row.directFilePath),
        libraryRootPath: asString(row.libraryRootPath),
        fileSubPath,
        fileName,
      });
      const fileHash = asString(row.currentHash) ?? asString(row.initialHash);
      const fileDurationSeconds = asInteger(row.fileDurationSeconds);

      if (sourceFileId && !next.files?.some((file) => file.sourceFileId === sourceFileId)) {
        next.files?.push({
          sourceFileId,
          sourceBookId,
          filePath,
          fileHash,
          fileName,
          fileSubPath,
          durationSeconds: fileDurationSeconds,
        });
      }

      if (!next.filePath) next.filePath = filePath;
      if (!next.fileHash) next.fileHash = fileHash;
      if (next.durationSeconds == null && fileDurationSeconds != null) next.durationSeconds = fileDurationSeconds;
      if (!next.title) next.title = asString(row.title);
      if (!next.author) next.author = asString(row.author);
      if (!next.isbn13) next.isbn13 = asString(row.isbn13);
      if (!next.isbn10) next.isbn10 = asString(row.isbn10);

      byBook.set(sourceBookId, next);
    }

    const books = [...byBook.values()];
    await this.attachAuthorsToBooks(conn, books, resolved.authors, resolved.authorMapping);
    return books;
  }

  private async attachAuthorsToBooks(
    conn: mysql.Connection,
    books: SourceBook[],
    authorTable: string | null,
    mappingTable: string | null,
  ): Promise<void> {
    if (!authorTable || !mappingTable) return;

    const mappingCols = await this.connector.listColumns(conn, mappingTable);
    const mapBookIdCol = firstColumn(mappingCols, ['book_id', 'bookid']);
    const mapAuthorIdCol = firstColumn(mappingCols, ['author_id', 'authorid']);
    const sortOrderCol = firstColumn(mappingCols, ['sort_order', 'display_order', 'position']);
    if (!mapBookIdCol || !mapAuthorIdCol) return;

    const authorCols = await this.connector.listColumns(conn, authorTable);
    const authorIdCol = firstColumn(authorCols, ['id', 'author_id']);
    const authorNameCol = firstColumn(authorCols, ['name', 'author_name']);
    const sortNameCol = firstColumn(authorCols, ['sort_name', 'sortname']);
    const descriptionCol = firstColumn(authorCols, ['description', 'bio']);
    if (!authorIdCol || !authorNameCol) return;

    const rows = await this.connector.queryRows(
      conn,
      `
      SELECT
        CAST(m.\`${mapBookIdCol}\` AS CHAR) AS bookId,
        CAST(a.\`${authorIdCol}\` AS CHAR) AS sourceContributorId,
        CAST(a.\`${authorNameCol}\` AS CHAR) AS name,
        ${sqlString('a', sortNameCol, 'sortName')},
        ${sqlString('a', descriptionCol, 'description')},
        ${sqlNumber('m', sortOrderCol, 'displayOrder')}
      FROM \`${mappingTable}\` m
      JOIN \`${authorTable}\` a ON a.\`${authorIdCol}\` = m.\`${mapAuthorIdCol}\`
      ORDER BY m.\`${mapBookIdCol}\`, ${sortOrderCol ? `m.\`${sortOrderCol}\`` : `a.\`${authorNameCol}\``}
      `,
    );

    const byBookId = new Map<string, SourceContributor[]>();
    for (const row of rows) {
      const bookId = asString(row.bookId);
      const name = asString(row.name);
      if (!bookId || !name) continue;
      const list = byBookId.get(bookId) ?? [];
      list.push({
        sourceContributorId: asString(row.sourceContributorId),
        name,
        sortName: asString(row.sortName),
        description: asString(row.description),
        displayOrder: asInteger(row.displayOrder) ?? list.length,
      });
      byBookId.set(bookId, list);
    }

    for (const book of books) {
      const authors = byBookId.get(book.sourceBookId);
      if (!authors) continue;
      book.authors = authors.sort((a, b) => a.displayOrder - b.displayOrder);
      book.author = book.authors.map((author) => author.name).join('; ');
    }
  }

  private async fetchUserBookStatuses(conn: mysql.Connection, progressTable: string | null): Promise<SourceUserBookStatus[]> {
    if (!progressTable) return [];

    const cols = await this.connector.listColumns(conn, progressTable);
    const userCol = firstColumn(cols, ['user_id', 'userid']);
    const bookCol = firstColumn(cols, ['book_id', 'bookid']);
    if (!userCol || !bookCol) return [];

    const statusCol = firstColumn(cols, ['status', 'read_status']);
    const pctCol = firstColumn(cols, [
      'percentage',
      'progress_percent',
      'progress',
      'percent_complete',
      'epub_progress',
      'pdf_progress',
      'cbx_progress',
      'koreader_progress',
    ]);
    const startedAtCol = firstColumn(cols, ['started_at', 'start_date', 'date_started']);
    const finishedAtCol = firstColumn(cols, ['finished_at', 'finish_date', 'completed_at', 'date_finished']);
    const updatedAtCol = firstColumn(cols, ['updated_at', 'modified_at', 'last_read_at', 'last_read_time']);

    const sqlText = `
      SELECT
        CAST(p.\`${userCol}\` AS CHAR) AS sourceUserId,
        CAST(p.\`${bookCol}\` AS CHAR) AS sourceBookId,
        ${sqlString('p', statusCol, 'status')},
        ${sqlNumber('p', pctCol, 'percentage')},
        ${sqlDate('p', startedAtCol, 'startedAt')},
        ${sqlDate('p', finishedAtCol, 'finishedAt')},
        ${sqlDate('p', updatedAtCol, 'updatedAt')}
      FROM \`${progressTable}\` p
    `;

    const rows = await this.connector.queryRows(conn, sqlText);

    return rows
      .map((row) => ({
        sourceUserId: asString(row.sourceUserId) ?? '',
        sourceBookId: asString(row.sourceBookId) ?? '',
        status: asString(row.status),
        percentage: asNumber(row.percentage),
        startedAt: toIso(row.startedAt),
        finishedAt: toIso(row.finishedAt),
        updatedAt: toIso(row.updatedAt),
      }))
      .filter((row) => !!row.sourceUserId && !!row.sourceBookId);
  }

  private async fetchUserFileProgress(
    conn: mysql.Connection,
    progressTable: string | null,
    bookFileTable: string | null,
  ): Promise<SourceUserFileProgress[]> {
    if (!progressTable) return [];

    const cols = await this.connector.listColumns(conn, progressTable);
    const userCol = firstColumn(cols, ['user_id', 'userid']);
    if (!userCol) return [];

    const directBookCol = firstColumn(cols, ['book_id', 'bookid']);
    const bookFileIdCol = firstColumn(cols, ['book_file_id', 'bookfile_id', 'file_id']);

    let joinSql = '';
    let sourceBookExpr = directBookCol ? `CAST(p.\`${directBookCol}\` AS CHAR)` : 'NULL';
    const sourceFileExpr = bookFileIdCol ? `CAST(p.\`${bookFileIdCol}\` AS CHAR)` : 'NULL';

    if (!directBookCol && bookFileIdCol && bookFileTable) {
      const fileCols = await this.connector.listColumns(conn, bookFileTable);
      const fileIdCol = firstColumn(fileCols, ['id', 'book_file_id']);
      const fileBookIdCol = firstColumn(fileCols, ['book_id', 'bookid']);
      if (fileIdCol && fileBookIdCol) {
        joinSql = `LEFT JOIN \`${bookFileTable}\` f ON f.\`${fileIdCol}\` = p.\`${bookFileIdCol}\``;
        sourceBookExpr = `CAST(f.\`${fileBookIdCol}\` AS CHAR)`;
      }
    }

    const pctCol = firstColumn(cols, ['percentage', 'progress_percent', 'progress', 'percent_complete']);
    const cfiCol = firstColumn(cols, ['cfi', 'location', 'position_data', 'tts_position_cfi']);
    const hrefCol = firstColumn(cols, ['position_href', 'href']);
    const pageCol = firstColumn(cols, ['page_number', 'page', 'page_index']);
    const positionCol = firstColumn(cols, ['position_seconds', 'position_ms', 'position']);
    const updatedAtCol = firstColumn(cols, ['updated_at', 'modified_at', 'last_read_at', 'last_read_time']);

    const sqlText = `
      SELECT
        CAST(p.\`${userCol}\` AS CHAR) AS sourceUserId,
        ${sourceBookExpr} AS sourceBookId,
        ${sourceFileExpr} AS sourceFileId,
        ${sqlNumber('p', pctCol, 'percentage')},
        ${sqlString('p', cfiCol, 'cfi')},
        ${sqlString('p', hrefCol, 'href')},
        ${sqlNumber('p', pageCol, 'pageNumber')},
        ${sqlNumber('p', positionCol, 'positionSeconds')},
        ${sqlDate('p', updatedAtCol, 'updatedAt')}
      FROM \`${progressTable}\` p
      ${joinSql}
    `;

    const rows = await this.connector.queryRows(conn, sqlText);

    return rows
      .map((row) => ({
        sourceUserId: asString(row.sourceUserId) ?? '',
        sourceBookId: asString(row.sourceBookId) ?? '',
        sourceFileId: asString(row.sourceFileId),
        percentage: asNumber(row.percentage),
        cfi: asString(row.cfi),
        href: asString(row.href),
        pageNumber: asInteger(row.pageNumber),
        positionSeconds: positionCol === 'position_ms' ? millisecondsToSeconds(asNumber(row.positionSeconds)) : asNumber(row.positionSeconds),
        updatedAt: toIso(row.updatedAt),
      }))
      .filter((row) => !!row.sourceUserId && !!row.sourceBookId);
  }

  private async fetchBookmarks(conn: mysql.Connection, bookmarkTable: string | null): Promise<SourceBookmark[]> {
    if (!bookmarkTable) return [];

    const cols = await this.connector.listColumns(conn, bookmarkTable);
    const userCol = firstColumn(cols, ['user_id', 'userid']);
    const bookCol = firstColumn(cols, ['book_id', 'bookid']);
    if (!userCol || !bookCol) return [];

    const bookFileCol = firstColumn(cols, ['book_file_id', 'bookfile_id', 'file_id']);
    const titleCol = firstColumn(cols, ['title', 'name']);
    const cfiCol = firstColumn(cols, ['cfi', 'location']);
    const posCol = firstColumn(cols, ['position_seconds', 'position_ms', 'position']);
    const trackIndexCol = firstColumn(cols, ['track_index', 'track']);
    const createdAtCol = firstColumn(cols, ['created_at', 'createdat']);

    const sqlText = `
      SELECT
        CAST(b.\`${userCol}\` AS CHAR) AS sourceUserId,
        CAST(b.\`${bookCol}\` AS CHAR) AS sourceBookId,
        ${bookFileCol ? `CAST(b.\`${bookFileCol}\` AS CHAR)` : 'NULL'} AS sourceFileId,
        ${sqlString('b', titleCol, 'title')},
        ${sqlString('b', cfiCol, 'cfi')},
        ${sqlNumber('b', posCol, 'positionSeconds')},
        ${sqlNumber('b', trackIndexCol, 'trackIndex')},
        ${sqlDate('b', createdAtCol, 'createdAt')}
      FROM \`${bookmarkTable}\` b
    `;

    const rows = await this.connector.queryRows(conn, sqlText);

    return rows
      .map((row) => ({
        sourceUserId: asString(row.sourceUserId) ?? '',
        sourceBookId: asString(row.sourceBookId) ?? '',
        sourceFileId: asString(row.sourceFileId),
        title: asString(row.title),
        cfi: asString(row.cfi),
        positionSeconds: posCol === 'position_ms' ? millisecondsToSeconds(asNumber(row.positionSeconds)) : asNumber(row.positionSeconds),
        trackIndex: asInteger(row.trackIndex),
        createdAt: toIso(row.createdAt),
      }))
      .filter((row) => !!row.sourceUserId && !!row.sourceBookId);
  }

  private async fetchAnnotations(conn: mysql.Connection, annotationsTable: string | null): Promise<SourceAnnotation[]> {
    if (!annotationsTable) return [];

    const cols = await this.connector.listColumns(conn, annotationsTable);
    const userCol = firstColumn(cols, ['user_id', 'userid']);
    const bookCol = firstColumn(cols, ['book_id', 'bookid']);
    const cfiCol = firstColumn(cols, ['cfi', 'location']);
    const textCol = firstColumn(cols, ['text', 'highlight_text', 'value']);

    if (!userCol || !bookCol || !cfiCol || !textCol) return [];

    const colorCol = firstColumn(cols, ['color']);
    const styleCol = firstColumn(cols, ['style', 'type']);
    const noteCol = firstColumn(cols, ['note', 'comment']);
    const chapterTitleCol = firstColumn(cols, ['chapter_title', 'chapter']);
    const createdAtCol = firstColumn(cols, ['created_at', 'createdat']);
    const updatedAtCol = firstColumn(cols, ['updated_at', 'updatedat']);

    const sqlText = `
      SELECT
        CAST(a.\`${userCol}\` AS CHAR) AS sourceUserId,
        CAST(a.\`${bookCol}\` AS CHAR) AS sourceBookId,
        CAST(a.\`${cfiCol}\` AS CHAR) AS cfi,
        CAST(a.\`${textCol}\` AS CHAR) AS text,
        ${sqlString('a', colorCol, 'color')},
        ${sqlString('a', styleCol, 'style')},
        ${sqlString('a', noteCol, 'note')},
        ${sqlString('a', chapterTitleCol, 'chapterTitle')},
        ${sqlDate('a', createdAtCol, 'createdAt')},
        ${sqlDate('a', updatedAtCol, 'updatedAt')}
      FROM \`${annotationsTable}\` a
    `;

    const rows = await this.connector.queryRows(conn, sqlText);

    return rows
      .map((row) => ({
        sourceUserId: asString(row.sourceUserId) ?? '',
        sourceBookId: asString(row.sourceBookId) ?? '',
        cfi: asString(row.cfi) ?? '',
        text: asString(row.text) ?? '',
        color: asString(row.color),
        style: asString(row.style),
        note: asString(row.note),
        chapterTitle: asString(row.chapterTitle),
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
      }))
      .filter((row) => !!row.sourceUserId && !!row.sourceBookId && !!row.cfi && !!row.text);
  }

  private async fetchShelves(
    conn: mysql.Connection,
    shelvesTable: string | null,
    shelfBooksTable: string | null,
    bookTable: string | null,
  ): Promise<{ shelves: SourceShelf[]; shelfBooks: SourceShelfBook[] }> {
    if (!shelvesTable || !shelfBooksTable) return { shelves: [], shelfBooks: [] };

    const shelfCols = await this.connector.listColumns(conn, shelvesTable);
    const shelfIdCol = firstColumn(shelfCols, ['id', 'shelf_id']);
    const shelfUserCol = firstColumn(shelfCols, ['user_id', 'userid']);
    const shelfNameCol = firstColumn(shelfCols, ['name', 'title']);

    if (!shelfIdCol || !shelfUserCol || !shelfNameCol) return { shelves: [], shelfBooks: [] };

    const shelvesRows = await this.connector.queryRows(
      conn,
      `
      SELECT
        CAST(s.\`${shelfIdCol}\` AS CHAR) AS sourceShelfId,
        CAST(s.\`${shelfUserCol}\` AS CHAR) AS sourceUserId,
        CAST(s.\`${shelfNameCol}\` AS CHAR) AS name
      FROM \`${shelvesTable}\` s
      `,
    );

    const shelves = shelvesRows
      .map((row) => ({
        sourceShelfId: asString(row.sourceShelfId) ?? '',
        sourceUserId: asString(row.sourceUserId) ?? '',
        name: asString(row.name) ?? 'Untitled Shelf',
      }))
      .filter((row) => !!row.sourceShelfId && !!row.sourceUserId);

    const mapCols = await this.connector.listColumns(conn, shelfBooksTable);
    const mapShelfIdCol = firstColumn(mapCols, ['shelf_id']);
    const mapBookIdCol = firstColumn(mapCols, ['book_id']);

    if (!mapShelfIdCol || !mapBookIdCol) {
      return {
        shelves,
        shelfBooks: [],
      };
    }

    const bookCols = bookTable ? await this.connector.listColumns(conn, bookTable) : null;
    const bookIdCol = bookCols ? firstColumn(bookCols, ['id', 'book_id']) : null;
    const mappingJoins = [`INNER JOIN \`${shelvesTable}\` s ON s.\`${shelfIdCol}\` = m.\`${mapShelfIdCol}\``];
    if (bookTable && bookIdCol) {
      mappingJoins.push(`INNER JOIN \`${bookTable}\` b ON b.\`${bookIdCol}\` = m.\`${mapBookIdCol}\``);
    }

    const shelfBookRows = await this.connector.queryRows(
      conn,
      `
      SELECT DISTINCT
        CAST(m.\`${mapShelfIdCol}\` AS CHAR) AS sourceShelfId,
        CAST(s.\`${shelfUserCol}\` AS CHAR) AS sourceUserId,
        CAST(m.\`${mapBookIdCol}\` AS CHAR) AS sourceBookId
      FROM \`${shelfBooksTable}\` m
      ${mappingJoins.join('\n')}
      ORDER BY m.\`${mapShelfIdCol}\`, m.\`${mapBookIdCol}\`
      `,
    );

    return {
      shelves,
      shelfBooks: shelfBookRows
        .map((row) => ({
          sourceShelfId: asString(row.sourceShelfId) ?? '',
          sourceUserId: asString(row.sourceUserId) ?? '',
          sourceBookId: asString(row.sourceBookId) ?? '',
        }))
        .filter((row) => !!row.sourceShelfId && !!row.sourceUserId && !!row.sourceBookId),
    };
  }
  private async attachCategoriesToBooks(
    conn: mysql.Connection,
    books: SourceBook[],
    categoryTable: string | null,
    mappingTable: string | null,
  ): Promise<void> {
    if (!categoryTable || !mappingTable) return;

    const mappingCols = await this.connector.listColumns(conn, mappingTable);
    const mapBookIdCol = firstColumn(mappingCols, ['book_id', 'bookid']);
    const mapCategoryIdCol = firstColumn(mappingCols, ['category_id', 'genre_id']);
    if (!mapBookIdCol || !mapCategoryIdCol) return;

    const categoryCols = await this.connector.listColumns(conn, categoryTable);
    const categoryIdCol = firstColumn(categoryCols, ['id']);
    const categoryNameCol = firstColumn(categoryCols, ['name']);
    if (!categoryIdCol || !categoryNameCol) return;

    const rows = await this.connector.queryRows(
      conn,
      `SELECT CAST(m.\`${mapBookIdCol}\` AS CHAR) AS bookId, CAST(c.\`${categoryNameCol}\` AS CHAR) AS name
       FROM \`${mappingTable}\` m
       JOIN \`${categoryTable}\` c ON c.\`${categoryIdCol}\` = m.\`${mapCategoryIdCol}\``,
    );

    const byBookId = new Map<string, string[]>();
    for (const row of rows) {
      const bookId = asString(row.bookId);
      const name = asString(row.name);
      if (!bookId || !name) continue;
      const existing = byBookId.get(bookId);
      if (existing) {
        existing.push(name);
      } else {
        byBookId.set(bookId, [name]);
      }
    }

    for (const book of books) {
      book.genres = byBookId.get(book.sourceBookId) ?? [];
    }
  }

  private async attachTagsToBooks(conn: mysql.Connection, books: SourceBook[], tagTable: string | null, mappingTable: string | null): Promise<void> {
    if (!tagTable || !mappingTable) return;

    const mappingCols = await this.connector.listColumns(conn, mappingTable);
    const mapBookIdCol = firstColumn(mappingCols, ['book_id', 'bookid']);
    const mapTagIdCol = firstColumn(mappingCols, ['tag_id']);
    if (!mapBookIdCol || !mapTagIdCol) return;

    const tagCols = await this.connector.listColumns(conn, tagTable);
    const tagIdCol = firstColumn(tagCols, ['id']);
    const tagNameCol = firstColumn(tagCols, ['name']);
    if (!tagIdCol || !tagNameCol) return;

    const rows = await this.connector.queryRows(
      conn,
      `SELECT CAST(m.\`${mapBookIdCol}\` AS CHAR) AS bookId, CAST(t.\`${tagNameCol}\` AS CHAR) AS name
       FROM \`${mappingTable}\` m
       JOIN \`${tagTable}\` t ON t.\`${tagIdCol}\` = m.\`${mapTagIdCol}\``,
    );

    const byBookId = new Map<string, string[]>();
    for (const row of rows) {
      const bookId = asString(row.bookId);
      const name = asString(row.name);
      if (!bookId || !name) continue;
      const existing = byBookId.get(bookId);
      if (existing) {
        existing.push(name);
      } else {
        byBookId.set(bookId, [name]);
      }
    }

    for (const book of books) {
      book.tags = byBookId.get(book.sourceBookId) ?? [];
    }
  }
}

function resolveTables(tables: Set<string>): TableResolution {
  return {
    users: resolveTable(tables, TABLE_CANDIDATES.users),
    book: resolveTable(tables, TABLE_CANDIDATES.book),
    bookFile: resolveTable(tables, TABLE_CANDIDATES.bookFile),
    bookMetadata: resolveTable(tables, TABLE_CANDIDATES.bookMetadata),
    libraryPath: resolveTable(tables, TABLE_CANDIDATES.libraryPath),
    authors: resolveTable(tables, TABLE_CANDIDATES.authors),
    authorMapping: resolveTable(tables, TABLE_CANDIDATES.authorMapping),
    userBookProgress: resolveTable(tables, TABLE_CANDIDATES.userBookProgress),
    userBookFileProgress: resolveTable(tables, TABLE_CANDIDATES.userBookFileProgress),
    bookmarks: resolveTable(tables, TABLE_CANDIDATES.bookmarks),
    annotations: resolveTable(tables, TABLE_CANDIDATES.annotations),
    pdfAnnotations: resolveTable(tables, TABLE_CANDIDATES.pdfAnnotations),
    shelves: resolveTable(tables, TABLE_CANDIDATES.shelves),
    shelfBooks: resolveTable(tables, TABLE_CANDIDATES.shelfBooks),
    categories: resolveTable(tables, TABLE_CANDIDATES.categories),
    categoryMapping: resolveTable(tables, TABLE_CANDIDATES.categoryMapping),
    tags: resolveTable(tables, TABLE_CANDIDATES.tags),
    tagMapping: resolveTable(tables, TABLE_CANDIDATES.tagMapping),
    bookNotes: resolveTable(tables, TABLE_CANDIDATES.bookNotes),
    bookNotesV2: resolveTable(tables, TABLE_CANDIDATES.bookNotesV2),
    epubViewerPreference: resolveTable(tables, TABLE_CANDIDATES.epubViewerPreference),
    pdfViewerPreference: resolveTable(tables, TABLE_CANDIDATES.pdfViewerPreference),
    cbxViewerPreference: resolveTable(tables, TABLE_CANDIDATES.cbxViewerPreference),
    newPdfViewerPreference: resolveTable(tables, TABLE_CANDIDATES.newPdfViewerPreference),
    koboUserSettings: resolveTable(tables, TABLE_CANDIDATES.koboUserSettings),
    koboReadingState: resolveTable(tables, TABLE_CANDIDATES.koboReadingState),
    comicMetadata: resolveTable(tables, TABLE_CANDIDATES.comicMetadata),
  };
}

function resolveTable(tables: Set<string>, candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    if (tables.has(candidate.toLowerCase())) return candidate;
  }
  return null;
}

function requiredColumn(columns: Set<string>, candidates: string[]): string {
  const found = firstColumn(columns, candidates);
  if (!found) {
    throw new Error(`Missing required column, expected one of: ${candidates.join(', ')}`);
  }
  return found;
}

function firstColumn(columns: Set<string>, candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (columns.has(candidate.toLowerCase())) return candidate;
  }
  return null;
}

function sqlString(alias: string, column: string | null, outName: string): string {
  if (!column) return `NULL AS ${outName}`;
  return `CAST(${alias}.\`${column}\` AS CHAR) AS ${outName}`;
}

function sqlNumber(alias: string, column: string | null, outName: string): string {
  if (!column) return `NULL AS ${outName}`;
  return `${alias}.\`${column}\` AS ${outName}`;
}

function sqlDate(alias: string, column: string | null, outName: string): string {
  if (!column) return `NULL AS ${outName}`;
  return `${alias}.\`${column}\` AS ${outName}`;
}

function buildSourceFilePath(input: {
  directPath: string | null;
  libraryRootPath: string | null;
  fileSubPath: string | null;
  fileName: string | null;
}): string | null {
  if (input.directPath) return normalizeJoinedPath(input.directPath);
  if (!input.libraryRootPath || !input.fileName) return null;
  return normalizeJoinedPath([input.libraryRootPath, input.fileSubPath, input.fileName].filter((part): part is string => !!part).join('/'));
}

function normalizeJoinedPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.replace(/\/{2,}/g, '/');
}

function parseContributorNames(value: string | null): SourceContributor[] {
  if (!value) return [];
  const parsed = parseJsonStringArray(value);
  const rawNames = parsed ?? value.split(/\s*(?:;|\|)\s*/);
  const seen = new Set<string>();
  const contributors: SourceContributor[] = [];
  for (const rawName of rawNames) {
    const name = rawName.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    contributors.push({
      sourceContributorId: null,
      name,
      sortName: null,
      description: null,
      displayOrder: contributors.length,
    });
  }
  return contributors;
}

function parseJsonStringArray(value: string): string[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const strings = parsed.filter((item): item is string => typeof item === 'string');
    return strings.length > 0 ? strings : null;
  } catch {
    return null;
  }
}

function parsePublishedYear(value: unknown): number | null {
  const direct = asInteger(value);
  if (direct != null && direct > 999 && direct < 10_000) return direct;
  const text = asString(value);
  if (!text) return null;
  const match = /\b(\d{4})\b/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : null;
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  const str =
    typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' ? String(value) : null;
  if (str == null) return null;
  const trimmed = str.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (value == null) return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function asInteger(value: unknown): number | null {
  const num = asNumber(value);
  if (num == null) return null;
  return Math.round(num);
}

function asBoolean(value: unknown): boolean | null {
  if (value == null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'bigint') return value !== 0n;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
  }
  return null;
}

function millisecondsToSeconds(value: number | null): number | null {
  return value == null ? null : value / 1000;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}
