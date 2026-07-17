import { Injectable } from '@nestjs/common';

@Injectable()
export class AuthorEnrichmentSessionService {
  private sessionTotal = 0;
  private sessionDone = 0;
  private sessionFailed = 0;
  private currentItemName: string | null = null;
  private revision = 0;

  addToTotal(count: number): void {
    if (count <= 0) return;
    if (this.sessionTotal > 0 && this.sessionDone >= this.sessionTotal) this.reset();
    this.sessionTotal += count;
    this.revision += 1;
  }

  incrementDone(failed = false): void {
    if (this.sessionTotal <= 0 || this.sessionDone >= this.sessionTotal) return;
    this.sessionDone += 1;
    if (failed) this.sessionFailed += 1;
    this.revision += 1;
  }

  setCurrentItemName(name: string | null): void {
    if (this.currentItemName === name) return;
    this.currentItemName = name;
    this.revision += 1;
  }

  getRevision(): number {
    return this.revision;
  }

  resetIfRevision(revision: number): boolean {
    if (this.revision !== revision) return false;
    this.reset();
    return true;
  }

  getSnapshot(): { sessionTotal: number; sessionDone: number; sessionFailed: number; currentItemName: string | null } {
    return {
      sessionTotal: this.sessionTotal,
      sessionDone: this.sessionDone,
      sessionFailed: this.sessionFailed,
      currentItemName: this.currentItemName,
    };
  }

  reset(): void {
    this.sessionTotal = 0;
    this.sessionDone = 0;
    this.sessionFailed = 0;
    this.currentItemName = null;
    this.revision += 1;
  }
}
