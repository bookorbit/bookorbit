import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export const METADATA_AUTHORS_REPLACED = 'metadata.authors.replaced';

export type MetadataAuthorsReplacedEvent = {
  bookId: number;
  authorIds: number[];
};

@Injectable()
export class MetadataEventsService extends EventEmitter {}
