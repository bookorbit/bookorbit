import { existsSync } from 'fs';
import { join } from 'path';
import { Worker } from 'worker_threads';

import type { WriteResult } from '@bookorbit/types';
import type { BookWritePayload, BookWritePayloadKey } from '../../interfaces/book-write-payload.interface';

export interface PdfWriteWorkerData {
  filePath: string;
  payload: BookWritePayload;
  fieldMask: BookWritePayloadKey[];
}

export type PdfWriteWorkerMessage =
  { type: 'result'; result: WriteResult } | { type: 'error'; errorClass: string; errorMessage: string; stack?: string };

interface PdfWorkerProcess {
  once(event: 'message', listener: (message: unknown) => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'exit', listener: (code: number) => void): this;
}

export type PdfWorkerFactory = (data: PdfWriteWorkerData) => PdfWorkerProcess;

export function createPdfWriteWorker(data: PdfWriteWorkerData): PdfWorkerProcess {
  const workerPath = resolvePdfWorkerPath();
  return new Worker(workerPath, {
    workerData: data,
    execArgv: workerPath.endsWith('.ts') ? ['--import', 'tsx'] : undefined,
  });
}

export function writePdfMetadataInWorker(data: PdfWriteWorkerData, createWorker: PdfWorkerFactory = createPdfWriteWorker): Promise<WriteResult> {
  return new Promise((resolve, reject) => {
    const worker = createWorker(data);
    let settled = false;

    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      callback();
    };

    worker.once('message', (message) => {
      settle(() => {
        if (isWorkerResultMessage(message)) {
          resolve(message.result);
          return;
        }
        if (isWorkerErrorMessage(message)) {
          reject(toWorkerError(message));
          return;
        }
        reject(new Error('PDF write worker returned an invalid response'));
      });
    });

    worker.once('error', (error) => {
      settle(() => reject(error));
    });

    worker.once('exit', (code) => {
      if (code === 0) return;
      settle(() => reject(new Error(`PDF write worker exited with code ${code}`)));
    });
  });
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
