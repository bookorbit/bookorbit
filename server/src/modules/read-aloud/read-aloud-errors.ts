import type { ReadAloudErrorCode } from '@bookorbit/types';

import { GeneratedFileError } from '../upload/generated-book-file.service';
import { InvalidReportError } from './read-aloud-report';
import { WorkerJobNotFoundError, WorkerRejectedError, WorkerUnreachableError } from './read-aloud-worker-client.service';

/** A failure with a code the client can localize. The message goes to `last_error` and the log only. */
export class ReadAloudJobError extends Error {
  constructor(
    readonly code: ReadAloudErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ReadAloudJobError';
  }
}

/** The job was cancelled while it ran. */
export class ReadAloudCancelledError extends ReadAloudJobError {
  constructor() {
    super('cancelled', 'Read-aloud job was cancelled');
    this.name = 'ReadAloudCancelledError';
  }
}

/** The worker stayed unreachable past the waiting window; the job goes back to the queue. */
export class ReadAloudWorkerLostError extends ReadAloudJobError {
  constructor(message: string) {
    super('worker_unavailable', message);
    this.name = 'ReadAloudWorkerLostError';
  }
}

/**
 * Maps any failure to a whitelisted code. Raw codes such as `ENOENT` or a Postgres `23505` never
 * reach the client; they stay in the message, which only the log and `last_error` see.
 */
export function classifyReadAloudError(error: unknown): ReadAloudErrorCode {
  if (error instanceof ReadAloudJobError) return error.code;
  if (error instanceof WorkerRejectedError) return error.code;
  if (error instanceof WorkerUnreachableError || error instanceof WorkerJobNotFoundError) return 'worker_unavailable';
  if (error instanceof InvalidReportError) return 'invalid_output';
  if (error instanceof GeneratedFileError) {
    if (error.reason === 'insufficient_storage') return 'insufficient_storage';
    if (error.reason === 'invalid_content' || error.reason === 'too_large') return 'invalid_output';
    return 'publication_failed';
  }
  return 'unknown';
}

/**
 * A failure while adding the output to the book. Disk space and bad output have their own messages;
 * anything else is a publication failure.
 */
export function publicationErrorCode(error: unknown): ReadAloudErrorCode {
  const code = classifyReadAloudError(error);
  return code === 'insufficient_storage' || code === 'invalid_output' ? code : 'publication_failed';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
