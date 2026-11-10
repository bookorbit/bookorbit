import { Injectable } from '@nestjs/common';

import type { NonceState } from './android-nonces';
import type { AppAttestEnvironment } from './app-attest-verifier';

export type AppAttestPlatform = 'ios' | 'android';

export interface StoredAppAttestKey extends NonceState {
  keyId: string;
  userId: number;
  publicKeyPem: string;
  appId: string;
  environment: AppAttestEnvironment;
  /** Absent for a key iOS registered. */
  platform?: AppAttestPlatform;
  counter: number;
  recentCounters: Set<number>;
  registeredAt: Date;
  lastAssertionAt?: Date;
}

const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_PENDING_CHALLENGES = 10_000;
const MAX_PENDING_CHALLENGES_PER_USER = 20;
const MAX_KEYS_PER_USER = 20;

/**
 * Prototype storage: in memory, so a restart forgets every key and the app re-attests on its next
 * covered request. A real rollout keeps keys in Postgres beside the session they were registered in.
 */
@Injectable()
export class AppAttestStore {
  private readonly challenges = new Map<string, { userId: number; expiresAt: number }>();
  private readonly keys = new Map<string, StoredAppAttestKey>();

  /** A user over their own limit loses their oldest challenge, so one account cannot push out another's. */
  addChallenge(challenge: string, userId: number, now = Date.now()): Date {
    this.pruneChallenges(now);
    this.evictOldestChallengesOf(userId);
    if (this.challenges.size >= MAX_PENDING_CHALLENGES) this.challenges.delete(this.challenges.keys().next().value!);
    const expiresAt = now + CHALLENGE_TTL_MS;
    this.challenges.set(challenge, { userId, expiresAt });
    return new Date(expiresAt);
  }

  /** Single use: a challenge is gone after the first attempt, whether or not that attempt verifies. */
  consumeChallenge(challenge: string, userId: number, now = Date.now()): boolean {
    const pending = this.challenges.get(challenge);
    this.challenges.delete(challenge);
    return pending !== undefined && pending.userId === userId && pending.expiresAt >= now;
  }

  /** Keys a reinstall left behind are never used again, so the least recently used one makes room. */
  saveKey(key: StoredAppAttestKey): void {
    this.keys.set(key.keyId, key);
    const owned = this.keysForUser(key.userId);
    if (owned.length <= MAX_KEYS_PER_USER) return;
    const lastUsed = (owned: StoredAppAttestKey) => (owned.lastAssertionAt ?? owned.registeredAt).getTime();
    for (const stale of owned.sort((a, b) => lastUsed(a) - lastUsed(b)).slice(0, owned.length - MAX_KEYS_PER_USER)) {
      if (stale.keyId !== key.keyId) this.keys.delete(stale.keyId);
    }
  }

  findKey(keyId: string): StoredAppAttestKey | undefined {
    return this.keys.get(keyId);
  }

  keysForUser(userId: number): StoredAppAttestKey[] {
    return [...this.keys.values()].filter((key) => key.userId === userId);
  }

  private evictOldestChallengesOf(userId: number): void {
    const owned = [...this.challenges].filter(([, pending]) => pending.userId === userId);
    for (const [challenge] of owned.slice(0, Math.max(0, owned.length - MAX_PENDING_CHALLENGES_PER_USER + 1))) {
      this.challenges.delete(challenge);
    }
  }

  private pruneChallenges(now: number): void {
    for (const [challenge, pending] of this.challenges) {
      if (pending.expiresAt < now) this.challenges.delete(challenge);
    }
  }
}
