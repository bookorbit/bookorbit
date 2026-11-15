import { Permission } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { currentApiKeyActor } from '../audit/api-key-audit-context';
import { BulkRunActorService, BulkRunStopped } from './bulk-run-actor.service';

const editor = { id: 7, active: true, isSuperuser: false, permissions: [Permission.LibraryEditMetadata] } as unknown as RequestUser;
const keyActor = {
  ...editor,
  credential: { kind: 'api_key', keyId: 41, keyName: 'Script', audience: 'api', access: 'write', libraryIds: null, ownerIsSuperuser: false },
} as unknown as RequestUser;

function setup() {
  const auth = { findActingUser: vi.fn((): Promise<RequestUser | null> => Promise.resolve(editor)) };
  const apiKeys = { actorForStoredKey: vi.fn((): Promise<RequestUser | null> => Promise.resolve(keyActor)) };
  return { service: new BulkRunActorService(auth as never, apiKeys as never), auth, apiKeys };
}

const sessionRun = { requestedBy: 7, credentialKind: 'session', apiKeyId: null };
const keyRun = { requestedBy: 7, credentialKind: 'api_key', apiKeyId: 41 };

async function stoppedCode(promise: Promise<unknown>): Promise<string | null> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  return error instanceof BulkRunStopped ? error.code : null;
}

describe('BulkRunActorService', () => {
  it('acts as the requester for a session run', async () => {
    const { service, auth } = setup();
    await expect(service.resolve(sessionRun)).resolves.toBe(editor);
    expect(auth.findActingUser).toHaveBeenCalledWith(7);
  });

  it('stops a session run when the account lost the permission or became a demo account', async () => {
    const { service, auth } = setup();
    auth.findActingUser.mockResolvedValueOnce({ ...editor, permissions: [] } as unknown as RequestUser);
    expect(await stoppedCode(service.resolve(sessionRun))).toBe('access-revoked');
    auth.findActingUser.mockResolvedValueOnce({
      ...editor,
      permissions: [Permission.LibraryEditMetadata, Permission.DemoRestricted],
    } as unknown as RequestUser);
    expect(await stoppedCode(service.resolve(sessionRun))).toBe('access-revoked');
    auth.findActingUser.mockResolvedValueOnce(null);
    expect(await stoppedCode(service.resolve(sessionRun))).toBe('access-revoked');
  });

  it('stops a run whose requester is gone', async () => {
    const { service } = setup();
    expect(await stoppedCode(service.resolve({ ...sessionRun, requestedBy: null }))).toBe('requester-gone');
  });

  it('acts as the key for a key run and stops when the key is revoked', async () => {
    const { service, apiKeys } = setup();
    await expect(service.resolve(keyRun)).resolves.toBe(keyActor);
    expect(apiKeys.actorForStoredKey).toHaveBeenCalledWith(41, 7);
    apiKeys.actorForStoredKey.mockResolvedValueOnce(null);
    expect(await stoppedCode(service.resolve(keyRun))).toBe('credential-revoked');
    expect(await stoppedCode(service.resolve({ ...keyRun, apiKeyId: null }))).toBe('credential-revoked');
  });

  it('names the key in audit events caused by a key run', async () => {
    const { service } = setup();
    await expect(service.as(keyActor, () => Promise.resolve(currentApiKeyActor()?.keyId))).resolves.toBe(41);
    await expect(service.as(editor, () => Promise.resolve(currentApiKeyActor()))).resolves.toBeUndefined();
  });
});
