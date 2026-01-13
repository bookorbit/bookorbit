import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

@Injectable()
export class OidcStateService {
  private readonly states = new Map<string, number>();
  private readonly TTL = 5 * 60 * 1000; // 5 minutes

  generate(): string {
    // Prune expired states
    const now = Date.now();
    for (const [state, ts] of this.states) {
      if (now - ts > this.TTL) this.states.delete(state);
    }

    const state = randomBytes(32).toString('base64url');
    this.states.set(state, Date.now());
    return state;
  }

  validateAndConsume(state: string): boolean {
    const ts = this.states.get(state);
    if (!ts) return false;
    this.states.delete(state); // one-time use
    return Date.now() - ts <= this.TTL;
  }
}
