import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { RequestCredentialService } from '../request-credential.service';
import { IndexerRepository } from './indexer.repository';

/**
 * Write-back for a session id the tracker rotated under us. Kept to its own tiny service so an
 * adapter never reaches for the repository, and so the dependency runs adapter -> store ->
 * repository rather than back into `IndexerConfigService`, which owns the adapters.
 *
 * Without this, a rotated session lives only in adapter memory and stops working at the next
 * restart - a failure that looks like "the tracker suddenly logged us out" days later.
 *
 * Every write goes through a per-indexer lock and an atomic check of what is stored. The caller
 * supplies the credential this rotation follows, so a late response cannot replace a newer
 * session or an operator's just-saved credential.
 */
@Injectable()
export class IndexerCredentialStore {
  private readonly logger = new Logger(IndexerCredentialStore.name);
  /** One tail per indexer, so writes to one row queue while writes to the others run freely. */
  private readonly writes = new Map<number, Promise<unknown>>();

  constructor(
    private readonly repo: IndexerRepository,
    private readonly credentials: RequestCredentialService,
  ) {}

  /**
   * Stores a rotated session. `previous` is the credential the caller was working from, which is
   * what tells a rotation of the current session apart from one of a session that has since been
   * replaced.
   */
  async rotate(indexerId: number, credential: string, previous: string | null): Promise<boolean> {
    const tail = (this.writes.get(indexerId) ?? Promise.resolve()).then(() => this.write(indexerId, credential, previous));
    // Cleared only if nothing queued behind it, so the tail is always the newest write.
    const tracked = tail.finally(() => {
      if (this.writes.get(indexerId) === tracked) this.writes.delete(indexerId);
    });
    this.writes.set(indexerId, tracked);
    return tail;
  }

  private async write(indexerId: number, credential: string, previous: string | null): Promise<boolean> {
    const started = Date.now();
    try {
      const row = await this.repo.findById(indexerId);
      if (!row || !this.matches(row.credentialsEnc, previous)) {
        this.logger.log(
          `[request_indexer.rotate] [end] indexerId=${indexerId} stored=false reason=changed durationMs=${Date.now() - started} - the stored credential changed while this session was in use`,
        );
        return false;
      }

      if (!(await this.repo.updateCredentialIfCurrent(indexerId, row.credentialsEnc, row.updatedAt, this.credentials.encrypt(credential)))) {
        this.logger.log(
          `[request_indexer.rotate] [end] indexerId=${indexerId} stored=false reason=raced durationMs=${Date.now() - started} - the stored credential changed while this session was being saved`,
        );
        return false;
      }
      this.logger.log(
        `[request_indexer.rotate] [end] indexerId=${indexerId} stored=true durationMs=${Date.now() - started} - stored a rotated tracker session`,
      );
      return true;
    } catch (error) {
      // A search that found releases must not fail because we could not write the new session
      // back; the old one keeps working until it lapses, and the next tick tries again.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[request_indexer.rotate] [fail] indexerId=${indexerId} durationMs=${Date.now() - started} errorClass=${error instanceof Error ? error.constructor.name : 'UnknownError'} error="${sanitizeLogValue(message)}" - could not store the rotated session`,
      );
      return false;
    }
  }

  private matches(encrypted: string | null, previous: string | null): boolean {
    if (encrypted === null) return previous === null;
    return this.credentials.decrypt(encrypted) === previous;
  }
}
