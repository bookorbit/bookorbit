import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

/**
 * Emitted with a `book_request_downloads.id` whenever an attempt ends badly.
 *
 * The seam exists so the retry policy can live in one place without the fulfilment service and
 * the automation service holding references to each other: fulfilment would need automation to
 * decide whether to retry, and automation needs fulfilment to perform the grab. Mirrors
 * `BookDockEventsService`, which the module already consumes for the same reason.
 */
export const BOOK_REQUEST_DOWNLOAD_FAILED = 'book-request.download.failed';

@Injectable()
export class BookRequestEventsService extends EventEmitter {}
