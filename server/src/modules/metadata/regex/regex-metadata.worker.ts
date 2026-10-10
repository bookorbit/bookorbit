import { parentPort } from 'node:worker_threads';
import { evaluateRegexMetadata, type RegexMetadataTask } from './regex-metadata-engine';

parentPort!.on('message', (task: RegexMetadataTask) => {
  parentPort!.postMessage(evaluateRegexMetadata(task));
});
parentPort!.postMessage('ready');
