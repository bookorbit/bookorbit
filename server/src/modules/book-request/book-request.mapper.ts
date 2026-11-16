import type {
  BookRequestDownloadItem,
  BookRequestDownloadSource,
  BookRequestDownloadStatus,
  BookRequestHandbackCode,
  BookRequestItem,
  BookRequestMediaKind,
  BookRequestStatus,
  BookRequestSubscriber,
} from '@bookorbit/types';
import { DOWNLOAD_CLIENT_ALWAYS_DELETES_REMOTE } from '@bookorbit/types';

import type { BookRequestJoinedRow } from './book-request.repository';
import type { BookRequestDownloadJoinedRow } from './fulfillment/book-request-download.repository';

/**
 * Shared by the request service and the fulfilment pipeline, both of which hand a request back
 * over HTTP. A second copy of this mapping is how a field ends up present on one endpoint and
 * missing on another.
 */
export function mapBookRequestRow(
  row: BookRequestJoinedRow,
  subscribers: BookRequestSubscriber[],
  download: BookRequestDownloadJoinedRow | null,
  dismissed: boolean,
): BookRequestItem {
  const r = row.request;
  return {
    id: r.id,
    userId: r.userId,
    requesterUsername: row.requesterUsername,
    requesterName: row.requesterName,
    mediaKind: r.mediaKind as BookRequestMediaKind,
    status: r.status as BookRequestStatus,
    title: r.title,
    subtitle: r.subtitle,
    authors: r.authors ?? [],
    seriesName: r.seriesName,
    seriesIndex: r.seriesIndex,
    isbn10: r.isbn10,
    isbn13: r.isbn13,
    publishedYear: r.publishedYear,
    language: r.language,
    coverUrl: r.coverUrl,
    providerKey: r.providerKey,
    providerId: r.providerId,
    metadataSources: r.metadataSources ?? [],
    preferredFormats: r.preferredFormats ?? [],
    note: r.note,
    targetLibraryId: r.targetLibraryId,
    targetLibraryName: row.targetLibraryName,
    targetFolderId: r.targetFolderId,
    decidedByUserId: r.decidedByUserId,
    decidedByUsername: row.decidedByUsername,
    decidedByName: row.decidedByName,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    matchedBookId: r.matchedBookId,
    bookDockFileId: r.bookDockFileId,
    selfServe: r.selfServe,
    fulfillerUserId: r.fulfillerUserId,
    statusReason: r.statusReason,
    failureCode: (r.failureCode as BookRequestHandbackCode | null) ?? null,
    failureMeta: r.failureMeta ?? null,
    subscribers,
    download: download ? mapBookRequestDownload(download) : null,
    dismissed,
    companionRequestId: r.companionRequestId ?? null,
    targetBookId: r.targetBookId ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/**
 * Whether removing this attempt from its client takes the downloaded data with it whatever the
 * caller asks. A refused attempt never reached the client, so nothing is held and nothing gets
 * deleted there: the generic copy is the honest one for it.
 */
export function downloadAlwaysDeletesRemote({
  download,
  downloadClientAdapterType,
}: Pick<BookRequestDownloadJoinedRow, 'download' | 'downloadClientAdapterType'>): boolean {
  return download.clientKey !== null && downloadClientAdapterType !== null && DOWNLOAD_CLIENT_ALWAYS_DELETES_REMOTE[downloadClientAdapterType];
}

export function mapBookRequestDownload({
  download,
  downloadClientName,
  downloadClientColor,
  downloadClientAdapterType,
  indexerName,
  indexerColor,
}: BookRequestDownloadJoinedRow): BookRequestDownloadItem {
  return {
    id: download.id,
    requestId: download.requestId,
    downloadClientId: download.downloadClientId,
    downloadClientName,
    downloadClientColor,
    alwaysDeletesRemote: downloadAlwaysDeletesRemote({ download, downloadClientAdapterType }),
    source: download.source as BookRequestDownloadSource,
    indexerId: download.indexerId,
    indexerName,
    indexerColor,
    automated: download.automated,
    releaseTitle: download.releaseTitle,
    releaseSizeBytes: download.releaseSizeBytes,
    clientKey: download.clientKey,
    status: download.status as BookRequestDownloadStatus,
    progressPercent: download.progressPercent,
    downloadedBytes: download.downloadedBytes,
    totalBytes: download.totalBytes,
    errorMessage: download.errorMessage,
    grabbedAt: download.grabbedAt?.toISOString() ?? null,
    completedAt: download.completedAt?.toISOString() ?? null,
    importedAt: download.importedAt?.toISOString() ?? null,
    releaseUnits: download.releaseUnits ?? null,
    createdAt: download.createdAt.toISOString(),
  };
}
