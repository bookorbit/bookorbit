import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

/**
 * Emitted with the id of an account that is about to be deleted, before anything is removed.
 *
 * Deleting a user cascades their rows away, and some of those rows are the only record of work
 * running somewhere else: a torrent in a download client, a file this process is still fetching.
 * Once the row is gone nothing knows the work exists, so whoever owns it has to be given the
 * chance to stop it first - which is why this fires before the delete and is waited on.
 *
 * The seam exists so the user module never learns what a book request is. A listener that throws
 * must not be able to stop an account being deleted, so the emitter logs and continues. What it
 * waits on is bounded by the listener: the download clients it talks to answer or time out.
 */
export const USER_DELETING = 'user.deleting';

export interface UserDeletingEvent {
  userId: number;
  /** Registers work to finish before the account and everything cascading from it is removed. */
  waitFor(work: Promise<void>): void;
}

@Injectable()
export class UserEventsService extends EventEmitter {}
