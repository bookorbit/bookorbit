import { BadRequestException, Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';

import { ensureSafeRemoteHost } from '../../../../common/utils/ssrf.utils';
import type { AudiobookshelfConnectionConfig } from './audiobookshelf-connection-config';
import type {
  AudiobookshelfAudioFileRecord,
  AudiobookshelfAuthorRecord,
  AudiobookshelfBookLibraryItemRecord,
  AudiobookshelfBookmarkRecord,
  AudiobookshelfEbookFileRecord,
  AudiobookshelfLibraryFolderRecord,
  AudiobookshelfLibraryItemRecord,
  AudiobookshelfMediaProgressRecord,
  AudiobookshelfPlaybackSessionRecord,
  AudiobookshelfPodcastLibraryItemRecord,
  AudiobookshelfSourceRecords,
  AudiobookshelfUserRecord,
} from './audiobookshelf-source.types';

type ApiConfig = Extract<AudiobookshelfConnectionConfig, { mode: 'api' }>;
type RequestMethod = 'GET' | 'POST';
type AddressFamily = 4 | 6;

interface AudiobookshelfStatus {
  sourceVersion: string | null;
}

interface AudiobookshelfAuthorizedUser {
  id: string;
  username: string;
  type: 'admin' | 'root';
}

interface AudiobookshelfLibrary {
  id: string;
  mediaType: string;
  folders: AudiobookshelfLibraryFolderRecord[];
}

interface Page<T> {
  results: T[];
  total: number;
  page: number;
}

interface SessionPage {
  sessions: AudiobookshelfPlaybackSessionRecord[];
  total: number;
  numPages: number;
  page: number;
}

export interface AudiobookshelfApiSnapshotSummary {
  sourceVersion: string | null;
  counts: Record<string, number>;
}

export interface JsonRequestOptions {
  method?: RequestMethod;
  body?: unknown;
  maxResponseBytes?: number;
  retryable?: boolean;
  timeoutMs?: number;
}

export interface PinnedAddress {
  address: string;
  family: AddressFamily;
}

export type AddressResolver = (hostname: string, options: { all: true; verbatim: true }) => Promise<Array<{ address: string; family: number }>>;
type RequestFactory = (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;

const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const EXPANDED_ITEMS_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const USER_DETAILS_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const LIBRARY_PAGE_SIZE = 200;
const ITEM_BATCH_SIZE = 100;
const SESSION_PAGE_SIZE = 100;
const USER_DETAIL_CONCURRENCY = 4;
const MAX_PAGE_COUNT = 100_000;
const MAX_REQUEST_ATTEMPTS = 2;
const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

@Injectable()
export class AudiobookshelfApiConnector {
  async getStatus(config: ApiConfig): Promise<AudiobookshelfStatus> {
    const payload = asRecord(await this.requestJson(config, '/status'));
    if (payload.app !== 'audiobookshelf') {
      throw new BadRequestException('The configured server is not Audiobookshelf');
    }
    if (payload.isInit !== true) {
      throw new BadRequestException('The Audiobookshelf server has not been initialized');
    }
    return { sourceVersion: nullableString(payload.serverVersion) };
  }

  async authorize(config: ApiConfig): Promise<AudiobookshelfAuthorizedUser> {
    const payload = asRecord(
      await this.requestJson(config, '/api/authorize', {
        method: 'POST',
        retryable: true,
      }),
    );
    const user = asRecord(payload.user);
    const id = requiredString(user.id);
    const username = requiredString(user.username);
    const type = requiredString(user.type)?.toLowerCase();
    if (!id || !username) throw new BadRequestException('Audiobookshelf authorization returned an invalid user');
    if (type !== 'admin' && type !== 'root') {
      throw new BadRequestException('Audiobookshelf API credentials must belong to an admin or root user');
    }
    return { id, username, type };
  }

  async getUsers(config: ApiConfig): Promise<AudiobookshelfUserRecord[]> {
    const payload = asRecord(await this.requestJson(config, '/api/users'));
    return asArray(payload.users)
      .map(mapUser)
      .filter((user): user is AudiobookshelfUserRecord => user !== null);
  }

  async getUserDetails(
    config: ApiConfig,
    sourceUserId: string,
  ): Promise<{
    user: AudiobookshelfUserRecord;
    mediaProgress: AudiobookshelfMediaProgressRecord[];
    bookmarks: AudiobookshelfBookmarkRecord[];
  }> {
    const payload = asRecord(
      await this.requestJson(config, `/api/users/${encodeURIComponent(sourceUserId)}`, {
        maxResponseBytes: USER_DETAILS_MAX_RESPONSE_BYTES,
      }),
    );
    const user = mapUser(payload);
    if (!user) throw new BadRequestException('Audiobookshelf returned an invalid user record');
    return {
      user,
      mediaProgress: asArray(payload.mediaProgress).map(mapMediaProgress).filter(isPresent),
      bookmarks: asArray(payload.bookmarks)
        .map((bookmark) => mapBookmark(bookmark, user.id))
        .filter(isPresent),
    };
  }

  async getLibraries(config: ApiConfig): Promise<AudiobookshelfLibrary[]> {
    const payload = asRecord(await this.requestJson(config, '/api/libraries'));
    return asArray(payload.libraries).map(mapLibrary).filter(isPresent);
  }

  async getLibraryItemsPage(config: ApiConfig, libraryId: string, page: number): Promise<Page<{ id: string; mediaType: string }>> {
    const path = `/api/libraries/${encodeURIComponent(libraryId)}/items?limit=${LIBRARY_PAGE_SIZE}&page=${page}&minified=1`;
    const payload = asRecord(await this.requestJson(config, path));
    return {
      results: asArray(payload.results).flatMap((raw) => {
        const row = asRecord(raw);
        const id = requiredString(row.id);
        return id ? [{ id, mediaType: requiredString(row.mediaType)?.toLowerCase() ?? '' }] : [];
      }),
      total: nonNegativeInteger(payload.total),
      page: nonNegativeInteger(payload.page),
    };
  }

  async getExpandedItems(config: ApiConfig, libraryItemIds: string[]): Promise<AudiobookshelfLibraryItemRecord[]> {
    if (libraryItemIds.length === 0 || libraryItemIds.length > ITEM_BATCH_SIZE) {
      throw new BadRequestException(`Audiobookshelf item batches must contain between 1 and ${ITEM_BATCH_SIZE} IDs`);
    }
    const payload = asRecord(
      await this.requestJson(config, '/api/items/batch/get', {
        method: 'POST',
        body: { libraryItemIds },
        maxResponseBytes: EXPANDED_ITEMS_MAX_RESPONSE_BYTES,
        retryable: true,
      }),
    );
    return asArray(payload.libraryItems).map(mapLibraryItem).filter(isPresent);
  }

  async getUserListeningSessionsPage(config: ApiConfig, sourceUserId: string, page: number): Promise<SessionPage> {
    const path = `/api/users/${encodeURIComponent(sourceUserId)}/listening-sessions?page=${page}&itemsPerPage=${SESSION_PAGE_SIZE}`;
    const payload = asRecord(await this.requestJson(config, path));
    return {
      sessions: asArray(payload.sessions).map(mapPlaybackSession).filter(isPresent),
      total: nonNegativeInteger(payload.total),
      numPages: nonNegativeInteger(payload.numPages),
      page: nonNegativeInteger(payload.page),
    };
  }

  async fetchSourceRecords(config: ApiConfig): Promise<AudiobookshelfSourceRecords> {
    const status = await this.getStatus(config);
    await this.authorize(config);
    const [users, libraries] = await Promise.all([this.getUsers(config), this.getLibraries(config)]);
    const userDetails = await mapWithConcurrency(users, USER_DETAIL_CONCURRENCY, (user) => this.getUserDetails(config, user.id));

    const libraryItems: AudiobookshelfLibraryItemRecord[] = [];
    for (const library of libraries) {
      if (library.mediaType !== 'book') continue;
      const itemIds = await this.getAllLibraryItemIds(config, library.id);
      for (let offset = 0; offset < itemIds.length; offset += ITEM_BATCH_SIZE) {
        libraryItems.push(...(await this.getExpandedItems(config, itemIds.slice(offset, offset + ITEM_BATCH_SIZE))));
      }
    }

    const playbackSessions = (
      await mapWithConcurrency(users, USER_DETAIL_CONCURRENCY, (user) => this.getAllListeningSessions(config, user.id))
    ).flat();

    return {
      sourceVersion: status.sourceVersion,
      users: userDetails.map((detail) => detail.user),
      libraryItems,
      mediaProgress: userDetails.flatMap((detail) => detail.mediaProgress),
      bookmarks: userDetails.flatMap((detail) => detail.bookmarks),
      playbackSessions,
      libraryFolders: libraries.flatMap((library) => library.folders),
      authorsAvailable: true,
      warnings: [],
    };
  }

  async fetchSnapshotSummary(config: ApiConfig): Promise<AudiobookshelfApiSnapshotSummary> {
    const status = await this.getStatus(config);
    await this.authorize(config);
    const [users, libraries] = await Promise.all([this.getUsers(config), this.getLibraries(config)]);
    const bookLibraries = libraries.filter((library) => library.mediaType === 'book');
    const [firstItemPages, userDetails, firstSessionPages] = await Promise.all([
      mapWithConcurrency(bookLibraries, USER_DETAIL_CONCURRENCY, (library) => this.getLibraryItemsPage(config, library.id, 0)),
      mapWithConcurrency(users, USER_DETAIL_CONCURRENCY, (user) => this.getUserDetails(config, user.id)),
      mapWithConcurrency(users, USER_DETAIL_CONCURRENCY, (user) => this.getUserListeningSessionsPage(config, user.id, 0)),
    ]);
    return {
      sourceVersion: status.sourceVersion,
      counts: {
        users: users.length,
        libraryItems: firstItemPages.reduce((total, page) => total + page.total, 0),
        mediaProgress: userDetails.reduce((total, detail) => total + detail.mediaProgress.length, 0),
        bookmarks: userDetails.reduce((total, detail) => total + detail.bookmarks.length, 0),
        readingSessions: firstSessionPages.reduce((total, page) => total + page.total, 0),
      },
    };
  }

  async fetchLibraryFolders(config: ApiConfig): Promise<AudiobookshelfLibraryFolderRecord[]> {
    await this.getStatus(config);
    await this.authorize(config);
    return (await this.getLibraries(config)).flatMap((library) => library.folders);
  }

  private async getAllLibraryItemIds(config: ApiConfig, libraryId: string): Promise<string[]> {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (let page = 0; page < MAX_PAGE_COUNT; page++) {
      const result = await this.getLibraryItemsPage(config, libraryId, page);
      const countBeforePage = ids.length;
      for (const item of result.results) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          ids.push(item.id);
        }
      }
      if (
        result.results.length === 0 ||
        // A server that ignores `page` returns the same rows forever, and deduplication keeps
        // `ids.length` below `total`, so no other condition here would ever terminate.
        ids.length === countBeforePage ||
        (result.total > 0 && ids.length >= result.total) ||
        (result.total === 0 && result.results.length < LIBRARY_PAGE_SIZE)
      ) {
        return ids;
      }
    }
    throw new BadRequestException('Audiobookshelf library pagination exceeded the safety limit');
  }

  private async getAllListeningSessions(config: ApiConfig, sourceUserId: string): Promise<AudiobookshelfPlaybackSessionRecord[]> {
    const sessions: AudiobookshelfPlaybackSessionRecord[] = [];
    const seen = new Set<string>();
    for (let page = 0; page < MAX_PAGE_COUNT; page++) {
      const result = await this.getUserListeningSessionsPage(config, sourceUserId, page);
      const countBeforePage = sessions.length;
      for (const session of result.sessions) {
        if (seen.has(session.id)) continue;
        seen.add(session.id);
        sessions.push(session);
      }
      if (
        result.sessions.length === 0 ||
        // Guards against a server that ignores `page` and replays the same rows indefinitely.
        sessions.length === countBeforePage ||
        (result.total > 0 && sessions.length >= result.total) ||
        (result.numPages > 0 && page + 1 >= result.numPages) ||
        (result.total === 0 && result.numPages === 0 && result.sessions.length < SESSION_PAGE_SIZE)
      ) {
        return sessions;
      }
    }
    throw new BadRequestException('Audiobookshelf listening-session pagination exceeded the safety limit');
  }

  private requestJson(config: ApiConfig, path: string, options: JsonRequestOptions = {}): Promise<unknown> {
    return requestAudiobookshelfJson(config, path, options);
  }
}

export async function requestAudiobookshelfJson(config: ApiConfig, path: string, options: JsonRequestOptions = {}): Promise<unknown> {
  const requestUrl = new URL(path, `${config.baseUrl}/`);
  if (requestUrl.origin !== config.baseUrl) throw new BadRequestException('Audiobookshelf request URL left the configured origin');

  let lastError: unknown;
  const retryable = options.retryable ?? (options.method ?? 'GET') === 'GET';
  const attempts = retryable ? MAX_REQUEST_ATTEMPTS : 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await requestJsonOnce(config, requestUrl, options);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientTransportError(error)) break;
    }
  }
  throw toSafeRequestException(lastError);
}

export async function resolvePinnedAddress(
  hostname: string,
  allowPrivateNetwork: boolean,
  resolver: AddressResolver = (value, options) => lookup(value, options),
): Promise<PinnedAddress> {
  let resolved: Array<{ address: string; family: number }>;
  try {
    const normalizedHostname = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
    resolved = await resolver(normalizedHostname, { all: true, verbatim: true });
  } catch {
    throw new BadRequestException('Unable to resolve the Audiobookshelf server');
  }
  const entries = resolved;
  if (entries.length === 0) throw new BadRequestException('Unable to resolve the Audiobookshelf server');

  for (const entry of entries) {
    await ensureSafeRemoteHost(entry.address, { allowPrivate: allowPrivateNetwork });
  }
  const selected = entries[0];
  if (selected.family !== 4 && selected.family !== 6) {
    throw new BadRequestException('Audiobookshelf server resolved to an unsupported address');
  }
  return { address: selected.address, family: selected.family };
}

function requestJsonOnce(config: ApiConfig, url: URL, options: JsonRequestOptions): Promise<unknown> {
  return new Promise((resolve, reject) => {
    void resolvePinnedAddress(url.hostname, config.allowPrivateNetwork)
      .then((pinned) => {
        const body = options.body === undefined ? null : Buffer.from(JSON.stringify(options.body), 'utf8');
        const requestFactory: RequestFactory = url.protocol === 'https:' ? httpsRequest : httpRequest;
        const request = requestFactory(
          url,
          {
            method: options.method ?? 'GET',
            headers: {
              accept: 'application/json',
              authorization: `Bearer ${config.apiToken}`,
              ...(body ? { 'content-type': 'application/json', 'content-length': body.byteLength } : {}),
            },
            lookup: createPinnedLookup(pinned) as never,
          },
          (response) => readJsonResponse(response, options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, resolve, reject),
        );
        request.setTimeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS, () => request.destroy(new TransportError('timeout')));
        request.on('error', (error) => reject(error instanceof TransportError ? error : new TransportError('network')));
        if (body) request.write(body);
        request.end();
      })
      .catch(reject);
  });
}

export function createPinnedLookup(pinned: PinnedAddress) {
  return (
    _hostname: string,
    lookupOptions: { all?: boolean } | undefined,
    callback: (error: Error | null, address: string | Array<{ address: string; family: number }>, family?: number) => void,
  ): void => {
    if (lookupOptions?.all) {
      callback(null, [{ address: pinned.address, family: pinned.family }]);
      return;
    }
    callback(null, pinned.address, pinned.family);
  };
}

function readJsonResponse(
  response: IncomingMessage,
  maxResponseBytes: number,
  resolve: (value: unknown) => void,
  reject: (reason?: unknown) => void,
): void {
  const statusCode = response.statusCode ?? 0;
  if (statusCode >= 300 && statusCode < 400) {
    response.resume();
    reject(new TransportError('redirect', statusCode));
    return;
  }
  if (statusCode < 200 || statusCode >= 300) {
    response.resume();
    reject(new TransportError('status', statusCode));
    return;
  }

  const declaredLength = Number(response.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    response.destroy();
    reject(new TransportError('response-size'));
    return;
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  response.on('data', (chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxResponseBytes) {
      response.destroy(new TransportError('response-size'));
      return;
    }
    chunks.push(buffer);
  });
  response.on('error', (error) => reject(error instanceof TransportError ? error : new TransportError('network')));
  response.on('end', () => {
    if (totalBytes > maxResponseBytes) return;
    try {
      resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch {
      reject(new TransportError('json'));
    }
  });
}

class TransportError extends Error {
  constructor(
    readonly kind: 'timeout' | 'network' | 'response-size' | 'redirect' | 'status' | 'json',
    readonly statusCode: number | null = null,
  ) {
    super(kind);
  }
}

function isTransientTransportError(error: unknown): boolean {
  return (
    error instanceof TransportError &&
    (error.kind === 'timeout' || error.kind === 'network' || (error.kind === 'status' && TRANSIENT_STATUS_CODES.has(error.statusCode ?? 0)))
  );
}

function toSafeRequestException(error: unknown): BadRequestException {
  if (error instanceof BadRequestException) return error;
  if (!(error instanceof TransportError)) return new BadRequestException('Audiobookshelf request failed');
  if (error.kind === 'timeout') return new BadRequestException('Audiobookshelf request timed out');
  if (error.kind === 'response-size') return new BadRequestException('Audiobookshelf response exceeded the allowed size');
  if (error.kind === 'redirect') return new BadRequestException('Audiobookshelf redirects are not allowed');
  if (error.kind === 'json') return new BadRequestException('Audiobookshelf returned invalid JSON');
  if (error.kind === 'status') {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return new BadRequestException('Audiobookshelf authentication or authorization failed');
    }
    return new BadRequestException(`Audiobookshelf request failed with status ${error.statusCode ?? 'unknown'}`);
  }
  return new BadRequestException('Could not reach the Audiobookshelf server');
}

function mapUser(raw: unknown): AudiobookshelfUserRecord | null {
  const row = asRecord(raw);
  const id = requiredString(row.id);
  const username = requiredString(row.username);
  if (!id || !username) return null;
  return {
    id,
    username,
    email: nullableString(row.email),
    isActive: typeof row.isActive === 'boolean' ? row.isActive : null,
  };
}

function mapLibrary(raw: unknown): AudiobookshelfLibrary | null {
  const row = asRecord(raw);
  const id = requiredString(row.id);
  const mediaType = requiredString(row.mediaType)?.toLowerCase();
  if (!id || !mediaType) return null;
  return {
    id,
    mediaType,
    folders: asArray(row.folders).flatMap((folder) => {
      const value = asRecord(folder);
      const path = requiredString(value.fullPath);
      return path
        ? [
            {
              id: nullableString(value.id),
              libraryId: nullableString(value.libraryId) ?? id,
              path,
            },
          ]
        : [];
    }),
  };
}

function mapLibraryItem(raw: unknown): AudiobookshelfLibraryItemRecord | null {
  const row = asRecord(raw);
  const id = requiredString(row.id);
  const mediaType = requiredString(row.mediaType)?.toLowerCase();
  if (!id || !mediaType) return null;
  if (mediaType !== 'book') {
    const podcast: AudiobookshelfPodcastLibraryItemRecord = {
      id,
      mediaType: 'podcast',
      path: nullableString(row.path),
      relPath: nullableString(row.relPath),
      mediaId: nullableString(asRecord(row.media).id),
    };
    return podcast;
  }

  const media = asRecord(row.media);
  const metadata = asRecord(media.metadata);
  const bookId = requiredString(media.id);
  if (!bookId) return null;
  const book: AudiobookshelfBookLibraryItemRecord = {
    id,
    mediaType: 'book',
    path: nullableString(row.path),
    relPath: nullableString(row.relPath),
    book: {
      id: bookId,
      title: nullableString(metadata.title),
      subtitle: nullableString(metadata.subtitle),
      authorName: nullableString(metadata.authorName),
      authors: mapItemAuthors(metadata),
      narrators: asArray(metadata.narrators).map(nullableString).filter(isPresent),
      isbn: nullableString(metadata.isbn),
      asin: nullableString(metadata.asin),
      description: nullableString(metadata.description),
      publisher: nullableString(metadata.publisher),
      publishedYear: stringOrNumber(metadata.publishedYear),
      language: nullableString(metadata.language),
      duration: finiteNumber(media.duration),
      abridged: typeof metadata.abridged === 'boolean' ? metadata.abridged : null,
      genres: asArray(metadata.genres).map(nullableString).filter(isPresent),
      tags: asArray(media.tags).map(nullableString).filter(isPresent),
      series: asArray(metadata.series).flatMap((series) => {
        const value = asRecord(series);
        const name = requiredString(value.name);
        return name ? [{ id: nullableString(value.id), name, sequence: stringOrNumber(value.sequence) }] : [];
      }),
      audioFiles: asArray(media.audioFiles).map(mapAudioFile).filter(isPresent),
      ebookFile: mapEbookFile(media.ebookFile),
    },
  };
  return book;
}

// The expanded item exposes per-author identity but only a single joined `authorNameLF`
// sort string, so it can be attributed to one author and no further. The backup connector
// reads the equivalent `authors.lastFirst` column per row.
function mapItemAuthors(metadata: Record<string, unknown>): AudiobookshelfAuthorRecord[] {
  const authors = asArray(metadata.authors).flatMap((author) => {
    const value = asRecord(author);
    const name = requiredString(value.name);
    return name ? [{ id: nullableString(value.id), name }] : [];
  });
  const sortName = nullableString(metadata.authorNameLF);
  return authors.length === 1 && sortName ? [{ ...authors[0], sortName }] : authors;
}

function mapAudioFile(raw: unknown): AudiobookshelfAudioFileRecord | null {
  const row = asRecord(raw);
  const metadata = asRecord(row.metadata);
  if (Object.keys(row).length === 0) return null;
  return {
    ino: stringOrNumber(row.ino),
    index: finiteNumber(row.index),
    format: nullableString(row.format),
    duration: finiteNumber(row.duration),
    exclude: typeof row.exclude === 'boolean' ? row.exclude : null,
    invalid: typeof row.invalid === 'boolean' ? row.invalid : null,
    metadata: {
      path: nullableString(metadata.path),
      relPath: nullableString(metadata.relPath),
      filename: nullableString(metadata.filename),
      ext: nullableString(metadata.ext),
    },
  };
}

function mapEbookFile(raw: unknown): AudiobookshelfEbookFileRecord | null {
  const row = asRecord(raw);
  if (Object.keys(row).length === 0) return null;
  const metadata = asRecord(row.metadata);
  return {
    ino: stringOrNumber(row.ino),
    ebookFormat: nullableString(row.ebookFormat),
    metadata: {
      path: nullableString(metadata.path),
      relPath: nullableString(metadata.relPath),
      filename: nullableString(metadata.filename),
      ext: nullableString(metadata.ext),
    },
  };
}

function mapMediaProgress(raw: unknown): AudiobookshelfMediaProgressRecord | null {
  const row = asRecord(raw);
  const userId = requiredString(row.userId);
  const mediaItemId = requiredString(row.mediaItemId);
  const mediaItemType = requiredString(row.mediaItemType);
  if (!userId || !mediaItemId || !mediaItemType) return null;
  return {
    id: nullableString(row.id),
    userId,
    mediaItemId,
    mediaItemType,
    libraryItemId: nullableString(row.libraryItemId),
    duration: finiteNumber(row.duration),
    progress: finiteNumber(row.progress),
    currentTime: finiteNumber(row.currentTime),
    ebookProgress: finiteNumber(row.ebookProgress),
    ebookLocation: nullableString(row.ebookLocation),
    isFinished: typeof row.isFinished === 'boolean' ? row.isFinished : null,
    startedAt: timestampValue(row.startedAt),
    lastUpdate: timestampValue(row.lastUpdate),
    createdAt: timestampValue(row.createdAt),
    updatedAt: timestampValue(row.updatedAt),
    finishedAt: timestampValue(row.finishedAt),
  };
}

function mapBookmark(raw: unknown, userId: string): AudiobookshelfBookmarkRecord | null {
  const row = asRecord(raw);
  const libraryItemId = requiredString(row.libraryItemId);
  const time = finiteNumber(row.time);
  if (!libraryItemId || time === null) return null;
  return {
    userId,
    libraryItemId,
    time,
    title: nullableString(row.title),
    createdAt: timestampValue(row.createdAt),
  };
}

function mapPlaybackSession(raw: unknown): AudiobookshelfPlaybackSessionRecord | null {
  const row = asRecord(raw);
  const id = requiredString(row.id);
  const userId = requiredString(row.userId);
  const mediaType = requiredString(row.mediaType)?.toLowerCase();
  const mediaItemId = mediaType === 'book' ? requiredString(row.bookId) : requiredString(row.episodeId);
  const duration = finiteNumber(row.duration);
  const startTime = finiteNumber(row.startTime);
  const currentTime = finiteNumber(row.currentTime);
  const timeListening = finiteNumber(row.timeListening);
  if (!id || !userId || !mediaType || !mediaItemId || duration === null || startTime === null || currentTime === null || timeListening === null) {
    return null;
  }
  return {
    id,
    userId,
    mediaItemId,
    mediaItemType: mediaType === 'book' ? 'book' : 'podcastEpisode',
    duration,
    startTime,
    currentTime,
    timeListening,
    startedAt: timestampValue(row.startedAt),
    createdAt: timestampValue(row.startedAt),
    updatedAt: timestampValue(row.updatedAt),
  };
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function requiredString(value: unknown): string | null {
  return nullableString(value);
}

function nullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function stringOrNumber(value: unknown): string | number | null {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? value : null;
}

function timestampValue(value: unknown): string | number | Date | null {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) || value instanceof Date ? value : null;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
