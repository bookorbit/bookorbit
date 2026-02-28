import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export const STAGING_FILE_INGESTED = 'staging.file.ingested';

@Injectable()
export class StagingEventsService extends EventEmitter {}
