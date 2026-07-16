import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { afterEach } from 'vitest';

import { eq, inArray } from 'drizzle-orm';
import {
  Permission,
  type BookDockDiscardDuplicatesResult,
  type BookDockFile,
  type BookDockFinalizePreviewResult,
  type BookDockFinalizeResult,
} from '@bookorbit/types';

import * as schema from '../src/db/schema';
import { buildFb2Fixture } from './e2e/book-dock/book-dock-fixture-builder';
import { createPdfFixture } from './e2e/metadata-write/metadata-write-fixture-builder';
import {
  authHeader,
  closeBookDockE2EContext,
  createLibraryWithFolder,
  createBookDockE2EContext,
  createBookDockRow,
  createUserAndLogin,
  fileExists,
  getBookDockRow,
  grantLibraryAccess,
  resetBookDockState,
  uploadBookDockFile,
  waitForBookDockStatus,
  type BookDockE2EContext,
} from './e2e/book-dock/book-dock-harness';

interface ScenarioRunResult {
  id: string;
  status: 'passed' | 'failed';
  durationMs: number;
  error?: string;
}

async function writeScenarioReport(results: ScenarioRunResult[]): Promise<void> {
  const reportDir = process.env.JUNIT_OUTPUT ? dirname(process.env.JUNIT_OUTPUT) : join(process.cwd(), '..', 'test-results', 'server');
  await mkdir(reportDir, { recursive: true });
  const reportPath = join(reportDir, 'book-dock-ingest-finalize-e2e-scenarios.json');
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        total: results.length,
        passed: results.filter((result) => result.status === 'passed').length,
        failed: results.filter((result) => result.status === 'failed').length,
        results,
      },
      null,
      2,
    ),
  );
}

describe('Book Dock ingest + finalize (e2e)', () => {
  let context!: BookDockE2EContext;
  const scenarioResults: ScenarioRunResult[] = [];
  let scenarioStartedAt = 0;

  beforeAll(async () => {
    context = await createBookDockE2EContext();
  });

  afterEach((taskContext) => {
    const result = taskContext.task.result;
    if (!result) return;

    const state = result.state === 'pass' ? 'passed' : 'failed';
    const error = result.errors?.[0]?.message;
    scenarioResults.push({
      id: taskContext.task.name,
      status: state,
      durationMs: Math.max(0, Date.now() - scenarioStartedAt),
      ...(error ? { error } : {}),
    });
  });

  afterAll(async () => {
    await writeScenarioReport(scenarioResults);
    if (context) {
      await closeBookDockE2EContext(context);
    }
  });

  beforeEach(async () => {
    scenarioStartedAt = Date.now();
    await resetBookDockState(context);
  });

  it('ingests upload, extracts metadata, and supports review editing', async () => {
    const destination = await createLibraryWithFolder(context);

    const uploadResponse = await uploadBookDockFile(context, {
      token: context.adminToken,
      fileName: 'ingest-review.fb2',
      content: buildFb2Fixture({
        title: 'Ingest Review Title',
        authors: ['Ingest Review Author'],
        description: 'Review flow',
      }),
      contentType: 'application/xml',
    });

    expect(uploadResponse.statusCode).toBe(201);
    const uploaded = uploadResponse.json() as BookDockFile;
    const ready = await waitForBookDockStatus(context, uploaded.id, ['ready']);

    expect(ready.embeddedMetadata?.title).toBe('Ingest Review Title');
    expect(ready.embeddedMetadata?.authors).toEqual(['Ingest Review Author']);
    expect(await fileExists(ready.absolutePath)).toBe(true);

    const patchResponse = await context.app.inject({
      method: 'PATCH',
      url: `/api/v1/book-dock/files/${uploaded.id}`,
      headers: authHeader(context.adminToken),
      payload: {
        selectedMetadata: {
          title: 'Edited Review Title',
          authors: ['Edited Review Author'],
          genres: ['Mystery'],
          hardcoverId: 'edited-review-book',
          hardcoverEditionId: 'edited-review-edition',
          openLibraryId: 'OL123W',
        },
        targetLibraryId: destination.libraryId,
        targetFolderId: destination.libraryFolderId,
      },
    });

    expect(patchResponse.statusCode).toBe(200);
    const updated = patchResponse.json() as BookDockFile;
    expect(updated.selectedMetadata).toMatchObject({
      title: 'Edited Review Title',
      authors: ['Edited Review Author'],
      genres: ['Mystery'],
      hardcoverId: 'edited-review-book',
      hardcoverEditionId: 'edited-review-edition',
      openLibraryId: 'OL123W',
    });
    expect(updated.targetLibraryId).toBe(destination.libraryId);
    expect(updated.targetFolderId).toBe(destination.libraryFolderId);

    const summaryResponse = await context.app.inject({
      method: 'GET',
      url: '/api/v1/book-dock/summary',
      headers: authHeader(context.adminToken),
    });
    expect(summaryResponse.statusCode).toBe(200);
    expect(summaryResponse.json()).toMatchObject({ total: 1, ready: 1 });
  });

  it('ingests pdf uploads and persists extracted cover files', async () => {
    const fixturePath = await createPdfFixture(context.fixture.rootPath, 'fixtures/book-dock-cover.pdf', 'Book Dock PDF Title');
    const pdfBytes = await readFile(fixturePath);

    const uploadResponse = await uploadBookDockFile(context, {
      token: context.adminToken,
      fileName: 'book-dock-cover.pdf',
      content: pdfBytes,
      contentType: 'application/pdf',
    });

    expect(uploadResponse.statusCode).toBe(201);
    const uploaded = uploadResponse.json() as BookDockFile;
    const ready = await waitForBookDockStatus(context, uploaded.id, ['ready']);

    expect(ready.embeddedMetadata?.title).toBe('Book Dock PDF Title');
    expect(ready.coverPath).toEqual(expect.stringContaining('.jpg'));
    expect(ready.coverPath).not.toBeNull();
    expect(await fileExists(ready.coverPath!)).toBe(true);
  });

  it('bulk set-target selectAll with status=pending includes pending, extracting, and fetching', async () => {
    const destination = await createLibraryWithFolder(context);
    const pendingRow = await createBookDockRow(context, { fileName: 'pending-target.fb2', status: 'pending' });
    const extractingRow = await createBookDockRow(context, { fileName: 'extracting-target.fb2', status: 'extracting' });
    const fetchingRow = await createBookDockRow(context, { fileName: 'fetching-target.fb2', status: 'fetching' });
    const readyRow = await createBookDockRow(context, { fileName: 'ready-target.fb2', status: 'ready' });

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/files/set-target',
      headers: authHeader(context.adminToken),
      payload: {
        selectAll: true,
        excludedIds: [fetchingRow.id],
        status: 'pending',
        targetLibraryId: destination.libraryId,
        targetFolderId: destination.libraryFolderId,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ total: 2, updated: 2, failed: 0 });

    const rows = await context.db
      .select({
        id: schema.bookDockFiles.id,
        targetLibraryId: schema.bookDockFiles.targetLibraryId,
        targetFolderId: schema.bookDockFiles.targetFolderId,
      })
      .from(schema.bookDockFiles)
      .where(inArray(schema.bookDockFiles.id, [pendingRow.id, extractingRow.id, fetchingRow.id, readyRow.id]));

    const rowById = new Map(rows.map((row) => [row.id, row]));
    expect(rowById.get(pendingRow.id)).toMatchObject({
      targetLibraryId: destination.libraryId,
      targetFolderId: destination.libraryFolderId,
    });
    expect(rowById.get(extractingRow.id)).toMatchObject({
      targetLibraryId: destination.libraryId,
      targetFolderId: destination.libraryFolderId,
    });
    expect(rowById.get(fetchingRow.id)).toMatchObject({ targetLibraryId: null, targetFolderId: null });
    expect(rowById.get(readyRow.id)).toMatchObject({ targetLibraryId: null, targetFolderId: null });
  });

  it('bulk edit and apply fetched respect filters and metadataEditedAt', async () => {
    const editableA = await createBookDockRow(context, {
      fileName: 'bulk-edit-target-a.fb2',
      selectedMetadata: { authors: ['Existing Author'] },
      fetchedMetadata: { title: 'Fetched A', authors: ['Fetched Author A'] },
    });
    const editableB = await createBookDockRow(context, {
      fileName: 'bulk-apply-edited-b.fb2',
      fetchedMetadata: { title: 'Fetched B' },
      metadataEditedAt: new Date(),
    });
    const untouched = await createBookDockRow(context, {
      fileName: 'untouched-record.fb2',
      selectedMetadata: { title: 'Untouched' },
      fetchedMetadata: { title: 'Fetched Untouched' },
    });

    const bulkEditResponse = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/files/bulk-edit',
      headers: authHeader(context.adminToken),
      payload: {
        selectAll: true,
        search: 'bulk-edit-target',
        fields: {
          title: 'Bulk Edited',
          authors: ['Merged Author'],
        },
        enabledFields: ['title', 'authors'],
        mergeArrays: true,
      },
    });

    expect(bulkEditResponse.statusCode).toBe(201);
    expect(bulkEditResponse.json()).toEqual({ total: 1, updated: 1, failed: 0 });

    const applyFetchedResponse = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/files/apply-fetched',
      headers: authHeader(context.adminToken),
      payload: {
        fileIds: [editableA.id, editableB.id, untouched.id],
      },
    });

    expect(applyFetchedResponse.statusCode).toBe(201);
    expect(applyFetchedResponse.json()).toEqual({
      total: 3,
      applied: 2,
      skipped: 0,
      skippedEdited: 1,
    });

    const [rowA, rowB, rowUntouched] = await Promise.all([
      getBookDockRow(context, editableA.id),
      getBookDockRow(context, editableB.id),
      getBookDockRow(context, untouched.id),
    ]);

    expect(rowA?.selectedMetadata).toMatchObject({ title: 'Fetched A', authors: ['Fetched Author A'] });
    expect(rowB?.selectedMetadata ?? null).toBeNull();
    expect(rowUntouched?.selectedMetadata).toMatchObject({ title: 'Fetched Untouched' });
  });

  it('bulk discard with selectAll + search honors excluded ids and removes files', async () => {
    const removable = await createBookDockRow(context, { fileName: 'discard-me-a.fb2' });
    const excluded = await createBookDockRow(context, { fileName: 'discard-me-b.fb2' });
    const untouched = await createBookDockRow(context, { fileName: 'keep-me.fb2' });

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/files/discard',
      headers: authHeader(context.adminToken),
      payload: {
        selectAll: true,
        search: 'discard-me',
        excludedIds: [excluded.id],
      },
    });

    expect(response.statusCode).toBe(204);
    expect(await getBookDockRow(context, removable.id)).toBeUndefined();
    expect(await getBookDockRow(context, excluded.id)).toBeDefined();
    expect(await getBookDockRow(context, untouched.id)).toBeDefined();

    expect(await fileExists(removable.absolutePath)).toBe(false);
    expect(await fileExists(excluded.absolutePath)).toBe(true);
    expect(await fileExists(untouched.absolutePath)).toBe(true);
  });

  it('finalize moves files into destination and creates book records', async () => {
    const destination = await createLibraryWithFolder(context);
    const bookDockRow = await createBookDockRow(context, {
      fileName: 'finalize-success.fb2',
      selectedMetadata: {
        title: 'Finalize Success Title',
        authors: ['Finalize Author'],
        hardcoverId: 'finalize-success-book',
        hardcoverEditionId: 'finalize-success-edition',
        openLibraryId: 'OL456W',
      },
      targetLibraryId: destination.libraryId,
      targetFolderId: destination.libraryFolderId,
    });

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/finalize',
      headers: authHeader(context.adminToken),
      payload: {
        fileIds: [bookDockRow.id],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as BookDockFinalizeResult;
    expect(body).toMatchObject({ total: 1, succeeded: 1, failed: 0 });
    expect(body.results[0]?.bookId).toEqual(expect.any(Number));

    const finalizedBookId = body.results[0]!.bookId!;

    const [book] = await context.db
      .select({
        id: schema.books.id,
        libraryId: schema.books.libraryId,
        folderPath: schema.books.folderPath,
      })
      .from(schema.books)
      .where(eq(schema.books.id, finalizedBookId))
      .limit(1);
    expect(book).toMatchObject({ id: finalizedBookId, libraryId: destination.libraryId });

    const [bookFile] = await context.db
      .select({
        absolutePath: schema.bookFiles.absolutePath,
        relPath: schema.bookFiles.relPath,
      })
      .from(schema.bookFiles)
      .where(eq(schema.bookFiles.bookId, finalizedBookId))
      .limit(1);
    expect(bookFile).toBeDefined();
    expect(bookFile!.absolutePath.startsWith(destination.folderPath)).toBe(true);
    expect(book?.folderPath).toBe(dirname(bookFile!.absolutePath));
    expect(await fileExists(bookFile!.absolutePath)).toBe(true);
    expect(await fileExists(bookDockRow.absolutePath)).toBe(false);

    const [metadata] = await context.db
      .select({
        title: schema.bookMetadata.title,
        hardcoverId: schema.bookMetadata.hardcoverId,
        hardcoverEditionId: schema.bookMetadata.hardcoverEditionId,
        openLibraryId: schema.bookMetadata.openLibraryId,
      })
      .from(schema.bookMetadata)
      .where(eq(schema.bookMetadata.bookId, finalizedBookId))
      .limit(1);
    expect(metadata).toMatchObject({
      title: 'Finalize Success Title',
      hardcoverId: 'finalize-success-book',
      hardcoverEditionId: 'finalize-success-edition',
      openLibraryId: 'OL456W',
    });
    expect(await getBookDockRow(context, bookDockRow.id)).toBeUndefined();
  });

  it('finalize returns partial success with duplicate and destination conflicts', async () => {
    const destination = await createLibraryWithFolder(context);

    const seedRow = await createBookDockRow(context, {
      fileName: 'seed-duplicate.fb2',
      selectedMetadata: { title: 'Duplicate Seed Title', authors: ['Duplicate Author'], isbn13: '9780306406157' },
      targetLibraryId: destination.libraryId,
      targetFolderId: destination.libraryFolderId,
    });
    const seedResponse = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/finalize',
      headers: authHeader(context.adminToken),
      payload: { fileIds: [seedRow.id] },
    });
    const seedBody = seedResponse.json() as BookDockFinalizeResult;
    const existingBookId = seedBody.results[0]!.bookId!;

    const duplicateRow = await createBookDockRow(context, {
      fileName: 'duplicate-input.fb2',
      selectedMetadata: { title: 'Duplicate Candidate Title', authors: ['Another Author'], isbn13: '9780306406157' },
      targetLibraryId: destination.libraryId,
      targetFolderId: destination.libraryFolderId,
    });
    const conflictRow = await createBookDockRow(context, {
      fileName: 'name-conflict.fb2',
      selectedMetadata: { title: 'Conflict Title', authors: ['Conflict Author'] },
      targetLibraryId: destination.libraryId,
      targetFolderId: destination.libraryFolderId,
    });
    const successRow = await createBookDockRow(context, {
      fileName: 'will-succeed.fb2',
      selectedMetadata: { title: 'Success Title', authors: ['Success Author'] },
      targetLibraryId: destination.libraryId,
      targetFolderId: destination.libraryFolderId,
    });

    const previewNamesResponse = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/files/preview-names',
      headers: authHeader(context.adminToken),
      payload: {
        fileIds: [conflictRow.id],
        defaultLibraryId: destination.libraryId,
      },
    });
    expect(previewNamesResponse.statusCode).toBe(201);
    const previewRows = previewNamesResponse.json() as Array<{ fileId: number; newName: string }>;
    const conflictNewName = previewRows.find((row) => row.fileId === conflictRow.id)?.newName;
    expect(conflictNewName).toEqual(expect.any(String));

    const existingDestinationPath = join(destination.folderPath, conflictNewName!);
    await mkdir(dirname(existingDestinationPath), { recursive: true });
    await writeFile(existingDestinationPath, 'already exists');

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/finalize',
      headers: authHeader(context.adminToken),
      payload: {
        fileIds: [duplicateRow.id, conflictRow.id, successRow.id],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as BookDockFinalizeResult;
    expect(body).toMatchObject({ total: 3, succeeded: 1, failed: 2 });

    const duplicateResult = body.results.find((result) => result.fileId === duplicateRow.id);
    const conflictResult = body.results.find((result) => result.fileId === conflictRow.id);
    const successResult = body.results.find((result) => result.fileId === successRow.id);

    expect(duplicateResult).toMatchObject({
      success: false,
      isDuplicate: true,
      existingBookId,
    });
    expect(conflictResult?.success).toBe(false);
    expect(conflictResult?.message).toContain('already exists at the target location');
    expect(successResult?.success).toBe(true);
    expect(successResult?.bookId).toEqual(expect.any(Number));

    expect(await getBookDockRow(context, duplicateRow.id)).toBeDefined();
    expect(await getBookDockRow(context, conflictRow.id)).toBeDefined();
    expect(await getBookDockRow(context, successRow.id)).toBeUndefined();
  });

  it('finalize preview reports duplicates and discard removes only duplicate candidates', async () => {
    const destination = await createLibraryWithFolder(context);

    const seedRow = await createBookDockRow(context, {
      fileName: 'preview-seed-duplicate.fb2',
      selectedMetadata: { title: 'Preview Duplicate Seed', authors: ['Preview Author'], isbn13: '9780306406157' },
      targetLibraryId: destination.libraryId,
      targetFolderId: destination.libraryFolderId,
    });
    const seedResponse = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/finalize',
      headers: authHeader(context.adminToken),
      payload: { fileIds: [seedRow.id] },
    });
    const seedBody = seedResponse.json() as BookDockFinalizeResult;
    const existingBookId = seedBody.results[0]!.bookId!;

    const duplicateRow = await createBookDockRow(context, {
      fileName: 'preview-duplicate-input.fb2',
      selectedMetadata: { title: 'Preview Duplicate Candidate', authors: ['Different Author'], isbn13: '9780306406157' },
      targetLibraryId: destination.libraryId,
      targetFolderId: destination.libraryFolderId,
    });
    const conflictRow = await createBookDockRow(context, {
      fileName: 'preview-name-conflict.fb2',
      selectedMetadata: { title: 'Preview Conflict Title', authors: ['Preview Conflict Author'] },
      targetLibraryId: destination.libraryId,
      targetFolderId: destination.libraryFolderId,
    });
    const readyRow = await createBookDockRow(context, {
      fileName: 'preview-ready.fb2',
      selectedMetadata: { title: 'Preview Ready Title', authors: ['Preview Ready Author'] },
      targetLibraryId: destination.libraryId,
      targetFolderId: destination.libraryFolderId,
    });

    const previewNamesResponse = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/files/preview-names',
      headers: authHeader(context.adminToken),
      payload: {
        fileIds: [conflictRow.id],
        defaultLibraryId: destination.libraryId,
      },
    });
    const previewRows = previewNamesResponse.json() as Array<{ fileId: number; newName: string }>;
    const conflictNewName = previewRows.find((row) => row.fileId === conflictRow.id)?.newName;
    expect(conflictNewName).toEqual(expect.any(String));
    const existingDestinationPath = join(destination.folderPath, conflictNewName!);
    await mkdir(dirname(existingDestinationPath), { recursive: true });
    await writeFile(existingDestinationPath, 'already exists');

    const previewResponse = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/finalize/preview',
      headers: authHeader(context.adminToken),
      payload: {
        fileIds: [duplicateRow.id, conflictRow.id, readyRow.id],
      },
    });

    expect(previewResponse.statusCode).toBe(200);
    const preview = previewResponse.json() as BookDockFinalizePreviewResult;
    expect(preview).toMatchObject({
      total: 3,
      ready: 1,
      duplicates: 1,
      destinationConflicts: 1,
      missingDestination: 0,
      blocked: 0,
    });
    expect(preview.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileId: duplicateRow.id, status: 'duplicate', existingBookId }),
        expect.objectContaining({ fileId: conflictRow.id, status: 'destination_conflict' }),
        expect.objectContaining({ fileId: readyRow.id, status: 'ready' }),
      ]),
    );

    const discardResponse = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/finalize/discard-duplicates',
      headers: authHeader(context.adminToken),
      payload: {
        fileIds: [duplicateRow.id, conflictRow.id, readyRow.id],
      },
    });

    expect(discardResponse.statusCode).toBe(200);
    const discard = discardResponse.json() as BookDockDiscardDuplicatesResult;
    expect(discard).toMatchObject({ total: 3, discarded: 1, skipped: 2, discardedFileIds: [duplicateRow.id] });
    expect(await getBookDockRow(context, duplicateRow.id)).toBeUndefined();
    expect(await getBookDockRow(context, conflictRow.id)).toBeDefined();
    expect(await getBookDockRow(context, readyRow.id)).toBeDefined();
    expect(await fileExists(duplicateRow.absolutePath)).toBe(false);
    expect(await fileExists(conflictRow.absolutePath)).toBe(true);
    expect(await fileExists(readyRow.absolutePath)).toBe(true);
  });

  it('finalize allows same title with different author when isbn is missing', async () => {
    const destination = await createLibraryWithFolder(context);

    const seedRow = await createBookDockRow(context, {
      fileName: 'seed-same-title.fb2',
      selectedMetadata: { title: 'Shared Title', authors: ['Author One'] },
      targetLibraryId: destination.libraryId,
      targetFolderId: destination.libraryFolderId,
    });
    const seedResponse = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/finalize',
      headers: authHeader(context.adminToken),
      payload: { fileIds: [seedRow.id] },
    });
    expect(seedResponse.statusCode).toBe(201);
    const seedBody = seedResponse.json() as BookDockFinalizeResult;
    expect(seedBody.results[0]?.success).toBe(true);
    const existingBookId = seedBody.results[0]!.bookId!;

    const candidateRow = await createBookDockRow(context, {
      fileName: 'candidate-same-title.fb2',
      selectedMetadata: { title: 'Shared Title', authors: ['Author Two'] },
      targetLibraryId: destination.libraryId,
      targetFolderId: destination.libraryFolderId,
    });

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/finalize',
      headers: authHeader(context.adminToken),
      payload: { fileIds: [candidateRow.id] },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as BookDockFinalizeResult;
    expect(body).toMatchObject({ total: 1, succeeded: 1, failed: 0 });
    expect(body.results[0]).toMatchObject({ fileId: candidateRow.id, success: true });
    expect(body.results[0]?.isDuplicate).toBeUndefined();
    expect(body.results[0]?.bookId).toEqual(expect.any(Number));
    expect(body.results[0]?.bookId).not.toBe(existingBookId);
    expect(await getBookDockRow(context, candidateRow.id)).toBeUndefined();
  });

  it('finalize stores a folder path even when the naming pattern is flat', async () => {
    const destination = await createLibraryWithFolder(context);
    await context.db.update(schema.libraries).set({ fileNamingPattern: '{title}' }).where(eq(schema.libraries.id, destination.libraryId));

    const bookDockRow = await createBookDockRow(context, {
      fileName: 'flat-pattern.fb2',
      selectedMetadata: {
        title: 'Flat Pattern Title',
        authors: ['Flat Pattern Author'],
      },
      targetLibraryId: destination.libraryId,
      targetFolderId: destination.libraryFolderId,
    });

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/finalize',
      headers: authHeader(context.adminToken),
      payload: {
        fileIds: [bookDockRow.id],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as BookDockFinalizeResult;
    expect(body).toMatchObject({ total: 1, succeeded: 1, failed: 0 });

    const finalizedBookId = body.results[0]!.bookId!;
    const [book] = await context.db
      .select({
        folderPath: schema.books.folderPath,
      })
      .from(schema.books)
      .where(eq(schema.books.id, finalizedBookId))
      .limit(1);
    const [bookFile] = await context.db
      .select({
        absolutePath: schema.bookFiles.absolutePath,
      })
      .from(schema.bookFiles)
      .where(eq(schema.bookFiles.bookId, finalizedBookId))
      .limit(1);

    expect(book?.folderPath).toBe(destination.folderPath);
    expect(book?.folderPath).toBe(dirname(bookFile!.absolutePath));
  });

  it('finalize treats title duplicates as exact matches instead of wildcard patterns', async () => {
    const destination = await createLibraryWithFolder(context);

    const seedRow = await createBookDockRow(context, {
      fileName: 'seed-wildcard-duplicate.fb2',
      selectedMetadata: { title: 'The Real Title', authors: ['Seed Author'] },
      targetLibraryId: destination.libraryId,
      targetFolderId: destination.libraryFolderId,
    });

    const seedResponse = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/finalize',
      headers: authHeader(context.adminToken),
      payload: { fileIds: [seedRow.id] },
    });
    expect(seedResponse.statusCode).toBe(201);
    expect((seedResponse.json() as BookDockFinalizeResult).results[0]?.success).toBe(true);

    const wildcardTitleRow = await createBookDockRow(context, {
      fileName: 'wildcard-title.fb2',
      selectedMetadata: { title: 'The %', authors: ['Wildcard Author'] },
      targetLibraryId: destination.libraryId,
      targetFolderId: destination.libraryFolderId,
    });

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/finalize',
      headers: authHeader(context.adminToken),
      payload: { fileIds: [wildcardTitleRow.id] },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as BookDockFinalizeResult;
    expect(body).toMatchObject({ total: 1, succeeded: 1, failed: 0 });
    expect(body.results[0]).toMatchObject({ fileId: wildcardTitleRow.id, success: true });
    expect(body.results[0]?.isDuplicate).toBeUndefined();
  });

  it('finalize selectAll honors status/search filters and excluded ids', async () => {
    const destination = await createLibraryWithFolder(context);

    const selected = await createBookDockRow(context, {
      fileName: 'batch-finalize-target-1.fb2',
      selectedMetadata: { title: 'Batch Finalize 1' },
      status: 'ready',
    });
    const excluded = await createBookDockRow(context, {
      fileName: 'batch-finalize-target-2.fb2',
      selectedMetadata: { title: 'Batch Finalize 2' },
      status: 'ready',
    });
    const unselected = await createBookDockRow(context, {
      fileName: 'other-finalize-target.fb2',
      selectedMetadata: { title: 'Other Finalize Target' },
      status: 'ready',
    });

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/finalize',
      headers: authHeader(context.adminToken),
      payload: {
        selectAll: true,
        status: 'ready',
        search: 'batch-finalize-target',
        excludedIds: [excluded.id],
        defaultLibraryId: destination.libraryId,
        defaultFolderId: destination.libraryFolderId,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ total: 1, succeeded: 1, failed: 0 });
    expect(await getBookDockRow(context, selected.id)).toBeUndefined();
    expect(await getBookDockRow(context, excluded.id)).toBeDefined();
    expect(await getBookDockRow(context, unselected.id)).toBeDefined();
  });

  it('finalize marks missing file ids as failures instead of silently skipping them', async () => {
    const destination = await createLibraryWithFolder(context);
    const successfulRow = await createBookDockRow(context, {
      fileName: 'missing-id-success.fb2',
      selectedMetadata: { title: 'Missing Id Success' },
      targetLibraryId: destination.libraryId,
      targetFolderId: destination.libraryFolderId,
    });
    const missingId = successfulRow.id + 50_000;

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/finalize',
      headers: authHeader(context.adminToken),
      payload: {
        fileIds: [successfulRow.id, missingId],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as BookDockFinalizeResult;
    expect(body).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(body.results.find((result) => result.fileId === missingId)).toMatchObject({
      success: false,
      message: 'Book Dock file not found',
    });
    expect(await getBookDockRow(context, successfulRow.id)).toBeUndefined();
  });

  it('enforces Book Dock permission and library access for finalize', async () => {
    const noPermissionUser = await createUserAndLogin(context);
    const withPermissionUser = await createUserAndLogin(context, {
      permissions: [Permission.BookDockAccess],
    });
    const destination = await createLibraryWithFolder(context);
    const bookDockRow = await createBookDockRow(context, {
      fileName: 'permission-check.fb2',
      selectedMetadata: { title: 'Permission Check' },
      status: 'ready',
    });

    const forbiddenSummary = await context.app.inject({
      method: 'GET',
      url: '/api/v1/book-dock/summary',
      headers: authHeader(noPermissionUser.accessToken),
    });
    expect(forbiddenSummary.statusCode).toBe(403);

    const allowedSummary = await context.app.inject({
      method: 'GET',
      url: '/api/v1/book-dock/summary',
      headers: authHeader(withPermissionUser.accessToken),
    });
    expect(allowedSummary.statusCode).toBe(200);

    const noAccessFinalize = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/finalize',
      headers: authHeader(withPermissionUser.accessToken),
      payload: {
        fileIds: [bookDockRow.id],
        defaultLibraryId: destination.libraryId,
        defaultFolderId: destination.libraryFolderId,
      },
    });

    expect(noAccessFinalize.statusCode).toBe(201);
    const noAccessBody = noAccessFinalize.json() as BookDockFinalizeResult;
    expect(noAccessBody).toMatchObject({ total: 1, succeeded: 0, failed: 1 });
    expect(noAccessBody.results[0]?.message).toContain('No access to this library');
    expect(await getBookDockRow(context, bookDockRow.id)).toBeDefined();

    await grantLibraryAccess(context, withPermissionUser.userId, destination.libraryId);

    const withAccessFinalize = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/finalize',
      headers: authHeader(withPermissionUser.accessToken),
      payload: {
        fileIds: [bookDockRow.id],
        defaultLibraryId: destination.libraryId,
        defaultFolderId: destination.libraryFolderId,
      },
    });

    expect(withAccessFinalize.statusCode).toBe(201);
    expect(withAccessFinalize.json()).toMatchObject({ total: 1, succeeded: 1, failed: 0 });
    expect(await getBookDockRow(context, bookDockRow.id)).toBeUndefined();
  });

  it('rejects invalid request payloads and supports retry-fetch recovery', async () => {
    const invalidPayloadResponse = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/files/bulk-edit',
      headers: authHeader(context.adminToken),
      payload: {
        fileIds: [123],
        fields: { title: 'Invalid' },
        enabledFields: ['title'],
        mergeArrays: false,
        unexpected: true,
      },
    });

    expect(invalidPayloadResponse.statusCode).toBe(400);
    const invalidBody = invalidPayloadResponse.json() as { message?: string[] };
    expect(invalidBody.message).toContain('property unexpected should not exist');

    const targetValidationResponse = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/files/set-target',
      headers: authHeader(context.adminToken),
      payload: {
        fileIds: [],
        targetLibraryId: 1,
      },
    });

    expect(targetValidationResponse.statusCode).toBe(400);
    expect(targetValidationResponse.json()).toMatchObject({
      message: 'targetLibraryId and targetFolderId must both be set or both be null',
    });

    const finalizeValidationResponse = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/finalize',
      headers: authHeader(context.adminToken),
      payload: {
        fileIds: [123],
        defaultLibraryId: 1,
      },
    });

    expect(finalizeValidationResponse.statusCode).toBe(400);
    expect(finalizeValidationResponse.json()).toMatchObject({
      message: expect.arrayContaining(['defaultLibraryId and defaultFolderId must either both be provided or both be omitted']),
    });

    const retriableErrorRow = await createBookDockRow(context, {
      fileName: 'retry-fetch.fb2',
      status: 'error',
      errorMessage: 'Previous metadata failure',
      content: buildFb2Fixture({
        title: 'Retry Fetch Title',
        authors: ['Retry Author'],
      }),
    });
    const nonErrorRow = await createBookDockRow(context, {
      fileName: 'retry-ignore.fb2',
      status: 'ready',
    });

    const retryResponse = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/files/retry-fetch',
      headers: authHeader(context.adminToken),
      payload: {
        fileIds: [retriableErrorRow.id, nonErrorRow.id],
      },
    });

    expect(retryResponse.statusCode).toBe(201);
    expect(retryResponse.json()).toEqual({ total: 2, queued: 1 });

    const retried = await waitForBookDockStatus(context, retriableErrorRow.id, ['ready']);
    expect(retried.errorMessage).toBeNull();
  });

  it('rejects unsupported upload formats', async () => {
    const response = await uploadBookDockFile(context, {
      token: context.adminToken,
      fileName: 'unsupported.txt',
      content: 'not a supported book format',
      contentType: 'text/plain',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      message: expect.stringContaining('Unsupported file type .txt'),
    });
  });

  it('returns destination validation failure when folder does not belong to selected library', async () => {
    const destinationA = await createLibraryWithFolder(context);
    const destinationB = await createLibraryWithFolder(context);
    const row = await createBookDockRow(context, {
      fileName: 'folder-mismatch.fb2',
      selectedMetadata: { title: 'Folder Mismatch' },
    });

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/book-dock/finalize',
      headers: authHeader(context.adminToken),
      payload: {
        fileIds: [row.id],
        defaultLibraryId: destinationA.libraryId,
        defaultFolderId: destinationB.libraryFolderId,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as BookDockFinalizeResult;
    expect(body).toMatchObject({ total: 1, succeeded: 0, failed: 1 });
    expect(body.results[0]?.message).toContain('Folder does not belong to this library');
    expect(await getBookDockRow(context, row.id)).toBeDefined();
  });
});
