import { Injectable } from '@nestjs/common';

/** One open response following a run. A write after the client left reports false and never throws. */
export interface BulkRunSink {
  write(event: object): boolean;
  end(): void;
}

/**
 * The open responses following each run in this process. A run never waits on them: closing a
 * response only detaches it, and the run goes on.
 */
@Injectable()
export class BulkRunStreams {
  private readonly sinks = new Map<string, Set<BulkRunSink>>();

  attach(runId: string, sink: BulkRunSink): void {
    const set = this.sinks.get(runId) ?? new Set<BulkRunSink>();
    set.add(sink);
    this.sinks.set(runId, set);
  }

  detach(runId: string, sink: BulkRunSink): void {
    const set = this.sinks.get(runId);
    if (!set) return;
    set.delete(sink);
    if (set.size === 0) this.sinks.delete(runId);
  }

  /** Whether an open response follows the run now. */
  following(runId: string): boolean {
    return (this.sinks.get(runId)?.size ?? 0) > 0;
  }

  emit(runId: string, event: object): void {
    for (const sink of [...(this.sinks.get(runId) ?? [])]) {
      if (!this.safeWrite(sink, event)) this.detach(runId, sink);
    }
  }

  /** Sends the final event, when there is one, and ends every response following the run. */
  close(runId: string, done: object | null): void {
    const set = this.sinks.get(runId);
    this.sinks.delete(runId);
    for (const sink of [...(set ?? [])]) {
      if (done) this.safeWrite(sink, done);
      try {
        sink.end();
      } catch {
        // The client already left.
      }
    }
  }

  /** Ends every open response, as the server stops, so none holds the HTTP server open. */
  closeAll(): void {
    for (const runId of [...this.sinks.keys()]) this.close(runId, null);
  }

  private safeWrite(sink: BulkRunSink, event: object): boolean {
    try {
      return sink.write(event);
    } catch {
      return false;
    }
  }
}
