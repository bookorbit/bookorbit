import { parentPort, workerData } from 'node:worker_threads';
import { evaluateRegexMetadata, type RegexMetadataTask, type RegexMetadataWorkerData } from './regex-metadata-engine';

const shared = workerData as RegexMetadataWorkerData;

parentPort!.on('message', (task: RegexMetadataTask) => {
  parentPort!.postMessage(evaluateRegexMetadata(task, shared));
});
parentPort!.postMessage('ready');
