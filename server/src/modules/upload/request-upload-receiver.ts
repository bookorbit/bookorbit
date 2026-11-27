import type { RequestUser } from '../../common/types/request-user';

/**
 * Where a `book_request` upload session delivers. The book request module provides it, and the
 * upload module asks for it only when a session names a request file: the request module already
 * imports this one, so depending on it directly would be a cycle.
 *
 * Every method throws a coded upload error for a file the session may not deliver.
 */
export abstract class RequestUploadReceiver {
  /** Refuses a file this user is not sending, or one whose name or size is not what was declared. */
  abstract admit(requestFileId: number, filename: string, sizeBytes: number, user: RequestUser): Promise<void>;

  /** Bytes reached the session. Best effort: the request shows them as progress. */
  abstract progress(requestFileId: number, receivedBytes: number): Promise<void>;

  /** The whole file is at `stagingPath`. Moves it into the attempt, which imports once every file is in. */
  abstract receive(requestFileId: number, stagingPath: string, user: RequestUser): Promise<void>;
}
