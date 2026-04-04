import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export const BOOK_BUCKET_FILE_INGESTED = 'book-bucket.file.ingested';

@Injectable()
export class BookBucketEventsService extends EventEmitter {}
