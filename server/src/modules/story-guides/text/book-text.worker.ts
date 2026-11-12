import { parentPort, workerData } from 'worker_threads';

import type { BookTextWorkerData, BookTextWorkerMessage } from './book-text-reader';
import { extractBookText } from './foliate-book-text';

async function run(): Promise<void> {
  const data = workerData as BookTextWorkerData;
  try {
    const result = await extractBookText(data.absolutePath, data.foliateDir);
    post({ type: 'result', result });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    post({ type: 'error', errorClass: err.name, errorMessage: err.message });
  }
}

function post(message: BookTextWorkerMessage): void {
  parentPort?.postMessage(message);
}

void run();
