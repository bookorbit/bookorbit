import { AsyncLocalStorage } from 'node:async_hooks';

export interface ApiKeyAuditActor {
  keyId: number;
  keyName: string;
}

const storage = new AsyncLocalStorage<ApiKeyAuditActor>();

/**
 * Runs a request made with an API key so that every audit event it causes names the key, including
 * the events services emit directly rather than through `@Auditable`.
 */
export function runAsApiKey<T>(actor: ApiKeyAuditActor, fn: () => T): T {
  return storage.run(actor, fn);
}

export function currentApiKeyActor(): ApiKeyAuditActor | undefined {
  return storage.getStore();
}
