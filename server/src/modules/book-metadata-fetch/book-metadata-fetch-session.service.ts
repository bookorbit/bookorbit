import { Injectable } from '@nestjs/common';

@Injectable()
export class BookMetadataFetchSessionService {
  private sessionTotal = 0;
  private sessionDone = 0;
  private currentItemName: string | null = null;

  addToTotal(count: number): void {
    if (count <= 0) return;
    this.sessionTotal += count;
  }

  incrementDone(): void {
    if (this.sessionTotal <= 0) return;
    if (this.sessionDone >= this.sessionTotal) return;
    this.sessionDone += 1;
  }

  setCurrentItemName(name: string | null): void {
    this.currentItemName = name;
  }

  getSnapshot(): { sessionTotal: number; sessionDone: number; currentItemName: string | null } {
    return { sessionTotal: this.sessionTotal, sessionDone: this.sessionDone, currentItemName: this.currentItemName };
  }

  reset(): void {
    this.sessionTotal = 0;
    this.sessionDone = 0;
    this.currentItemName = null;
  }
}
