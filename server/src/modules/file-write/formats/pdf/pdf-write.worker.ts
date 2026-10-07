import { parentPort, workerData } from 'worker_threads';

import type { BookWritePayloadKey } from '../../interfaces/book-write-payload.interface';
import { writePdfMetadataInProcess } from './pdf-write-core';
import type { PdfWriteWorkerData, PdfWriteWorkerMessage } from './pdf-worker-runner';

async function run(): Promise<void> {
  if (!parentPort) {
    throw new Error('PDF write worker requires a parent port');
  }

  const data = workerData as PdfWriteWorkerData;
  try {
    const result = await writePdfMetadataInProcess(
      data.filePath,
      data.payload,
      new Set<BookWritePayloadKey>(data.fieldMask),
      Date.now(),
      data.tempPath,
    );
    postMessage({ type: 'result', result });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    postMessage({
      type: 'error',
      errorClass: err.name,
      errorMessage: err.message,
      stack: err.stack,
    });
  }
}

function postMessage(message: PdfWriteWorkerMessage): void {
  parentPort!.postMessage(message);
}

void run();
