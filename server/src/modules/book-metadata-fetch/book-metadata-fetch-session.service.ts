import { Injectable } from '@nestjs/common';

@Injectable()
export class BookMetadataFetchSessionService {
  sessionTotal = 0;
  sessionDone = 0;
  currentItemName: string | null = null;

  getSnapshot(): { sessionTotal: number; sessionDone: number; currentItemName: string | null } {
    return { sessionTotal: this.sessionTotal, sessionDone: this.sessionDone, currentItemName: this.currentItemName };
  }

  reset(): void {
    this.sessionTotal = 0;
    this.sessionDone = 0;
    this.currentItemName = null;
  }
}
