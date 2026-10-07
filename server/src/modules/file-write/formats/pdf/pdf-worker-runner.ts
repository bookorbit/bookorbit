import { existsSync } from 'fs';
import { join } from 'path';
import { Worker } from 'worker_threads';

import type { WriteResult } from '@bookorbit/types';
import type { BookWritePayload, BookWritePayloadKey } from '../../interfaces/book-write-payload.interface';
import { pdfTempPathFor, removePdfTempFile } from './pdf-write-core';

export const PDF_WORKER_TIMEOUT_MS = 5 * 60_000;

export interface PdfWriteRequest {
  filePath: string;
  payload: BookWritePayload;
  fieldMask: BookWritePayloadKey[];
}

export interface PdfWriteWorkerData extends PdfWriteRequest {
  /** Owned by the runner so it can remove a partial file from a worker it had to terminate. */
  tempPath: string;
}

export type PdfWriteWorkerMessage =
  { type: 'result'; result: WriteResult } | { type: 'error'; errorClass: string; errorMessage: string; stack?: string };

interface PdfWorkerProcess {
  once(event: 'message', listener: (message: unknown) => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'exit', listener: (code: number) => void): this;
  terminate(): Promise<number>;
}

export type PdfWorkerFactory = (data: PdfWriteWorkerData) => PdfWorkerProcess;

export function createPdfWriteWorker(data: PdfWriteWorkerData): PdfWorkerProcess {
  const workerPath = resolvePdfWorkerPath();
  return new Worker(workerPath, {
    workerData: data,
    execArgv: workerPath.endsWith('.ts') ? ['--import', 'tsx'] : undefined,
  });
}

export function writePdfMetadataInWorker(
  request: PdfWriteRequest,
  createWorker: PdfWorkerFactory = createPdfWriteWorker,
  timeoutMs: number = PDF_WORKER_TIMEOUT_MS,
): Promise<WriteResult> {
  const tempPath = pdfTempPathFor(request.filePath);

  return new Promise((resolve, reject) => {
    const worker = createWorker({ ...request, tempPath });
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void worker
        .terminate()
        .catch(() => undefined)
        .then(() => removePdfTempFile(tempPath))
        .then(() => reject(timeoutError(timeoutMs)));
    }, timeoutMs);
    timer.unref?.();

    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    const fail = (error: Error): void => {
      settle(() => {
        void removePdfTempFile(tempPath).then(() => reject(error));
      });
    };

    worker.once('message', (message) => {
      if (isWorkerResultMessage(message)) {
        settle(() => resolve(message.result));
        return;
      }
      fail(isWorkerErrorMessage(message) ? toWorkerError(message) : new Error('PDF write worker returned an invalid response'));
    });

    worker.once('error', (error) => {
      fail(error);
    });

    worker.once('exit', (code) => {
      fail(new Error(code === 0 ? 'PDF write worker exited without a result' : `PDF write worker exited with code ${code}`));
    });
  });
}

function timeoutError(timeoutMs: number): Error {
  const error = new Error(`PDF write timed out after ${Math.round(timeoutMs / 1000)}s`);
  error.name = 'TimeoutError';
  return error;
}

function resolvePdfWorkerPath(): string {
  const jsPath = join(__dirname, 'pdf-write.worker.js');
  if (existsSync(jsPath)) return jsPath;

  const tsPath = join(__dirname, 'pdf-write.worker.ts');
  if (existsSync(tsPath)) return tsPath;

  return jsPath;
}

function isWorkerResultMessage(message: unknown): message is Extract<PdfWriteWorkerMessage, { type: 'result' }> {
  return typeof message === 'object' && message !== null && (message as PdfWriteWorkerMessage).type === 'result' && 'result' in message;
}

function isWorkerErrorMessage(message: unknown): message is Extract<PdfWriteWorkerMessage, { type: 'error' }> {
  return typeof message === 'object' && message !== null && (message as PdfWriteWorkerMessage).type === 'error' && 'errorMessage' in message;
}

function toWorkerError(message: Extract<PdfWriteWorkerMessage, { type: 'error' }>): Error {
  const error = new Error(message.errorMessage);
  error.name = message.errorClass || 'Error';
  if (message.stack) error.stack = message.stack;
  return error;
}
