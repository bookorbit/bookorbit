import { existsSync } from 'fs';
import { join } from 'path';
import { Worker } from 'worker_threads';

import type { PdfParsed, PdfParseWarning } from './pdf-parser';

export interface PdfParseWorkerData {
  absolutePath: string;
  extractCover: boolean;
}

export interface PdfParseWorkerResult {
  parsed: PdfParsed | null;
  warnings: PdfParseWarning[];
}

export type PdfParseWorkerMessage =
  { type: 'result'; result: PdfParseWorkerResult } | { type: 'error'; errorClass: string; errorMessage: string; stack?: string };

interface PdfWorkerProcess {
  once(event: 'message', listener: (message: unknown) => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'exit', listener: (code: number) => void): this;
}

export type PdfParseWorkerFactory = (data: PdfParseWorkerData) => PdfWorkerProcess;

export function createPdfParseWorker(data: PdfParseWorkerData): PdfWorkerProcess {
  const workerPath = resolvePdfWorkerPath();
  return new Worker(workerPath, {
    workerData: data,
    execArgv: workerPath.endsWith('.ts') ? ['--import', 'tsx'] : undefined,
  });
}

export function parsePdfFileInWorker(
  data: PdfParseWorkerData,
  createWorker: PdfParseWorkerFactory = createPdfParseWorker,
): Promise<PdfParseWorkerResult> {
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
          resolve(normalizeWorkerResult(message.result));
          return;
        }
        if (isWorkerErrorMessage(message)) {
          reject(toWorkerError(message));
          return;
        }
        reject(new Error('PDF parse worker returned an invalid response'));
      });
    });

    worker.once('error', (error) => {
      settle(() => reject(error));
    });

    worker.once('exit', (code) => {
      if (code === 0) return;
      settle(() => reject(new Error(`PDF parse worker exited with code ${code}`)));
    });
  });
}

function resolvePdfWorkerPath(): string {
  const jsPath = join(__dirname, 'pdf-parse.worker.js');
  if (existsSync(jsPath)) return jsPath;

  const tsPath = join(__dirname, 'pdf-parse.worker.ts');
  if (existsSync(tsPath)) return tsPath;

  return jsPath;
}

function isWorkerResultMessage(message: unknown): message is Extract<PdfParseWorkerMessage, { type: 'result' }> {
  return typeof message === 'object' && message !== null && (message as PdfParseWorkerMessage).type === 'result' && 'result' in message;
}

function isWorkerErrorMessage(message: unknown): message is Extract<PdfParseWorkerMessage, { type: 'error' }> {
  return typeof message === 'object' && message !== null && (message as PdfParseWorkerMessage).type === 'error' && 'errorMessage' in message;
}

function normalizeWorkerResult(result: PdfParseWorkerResult): PdfParseWorkerResult {
  if (!result.parsed?.coverBuffer || Buffer.isBuffer(result.parsed.coverBuffer)) {
    return result;
  }

  return {
    ...result,
    parsed: {
      ...result.parsed,
      coverBuffer: Buffer.from(result.parsed.coverBuffer),
    },
  };
}

function toWorkerError(message: Extract<PdfParseWorkerMessage, { type: 'error' }>): Error {
  const error = new Error(message.errorMessage);
  error.name = message.errorClass || 'Error';
  if (message.stack) error.stack = message.stack;
  return error;
}
