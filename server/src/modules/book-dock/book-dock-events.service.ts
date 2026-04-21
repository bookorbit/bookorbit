import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export const BOOK_DOCK_FILE_INGESTED = 'book-dock.file.ingested';

@Injectable()
export class BookDockEventsService extends EventEmitter {}
