import { randomBytes } from 'node:crypto';

import { BadRequestException, ForbiddenException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { AndroidKeyAttestService } from './android-key-attest.service';
import type { AndroidAttestationPolicy } from './android-key-verifier';
import { APP_ATTEST_HEADERS, AppAttestService, androidAttestClientData, appAttestBodySha256, type AttestedRequest } from './app-attest.service';
import { AppAttestStore } from './app-attest.store';
import { AttestationRevocations } from './attestation-revocations';
import {
  androidAssertion,
  androidChain,
  FIXTURE_PACKAGE,
  FIXTURE_SIGNATURE_DIGEST,
  type AndroidChain,
} from './test-fixtures/android-attestation-test-helpers';
import { ATTESTATION_FIXTURE } from './test-fixtures/attestation-fixture';

const user = { id: 7 } as RequestUser;
const otherUser = { id: 8 } as RequestUser;
const url = '/api/v1/notebook/overview?libraryIds=1';

class StubRevocations extends AttestationRevocations {
  revoked = new Set<string>();
  override anyRevoked(serials: readonly string[]): Promise<boolean> {
    return Promise.resolve(serials.some((serial) => this.revoked.has(serial)));
  }
}

function setup() {
  const chain = androidChain();
  const policy: AndroidAttestationPolicy = {
    apps: [{ packageName: FIXTURE_PACKAGE, signatureDigests: [FIXTURE_SIGNATURE_DIGEST.toString('hex')], development: false }],
    trustedRoots: [chain.rootPem],
    allowDevelopment: false,
  };
  const store = new AppAttestStore();
  const revocations = new StubRevocations();
  const androidKeys = new AndroidKeyAttestService(policy, store, revocations);
  const appAttest = new AppAttestService(
    { appIds: [ATTESTATION_FIXTURE.appId], allowDevelopment: true, trustedRoots: [ATTESTATION_FIXTURE.rootPem] },
    store,
  );
  return { chain, store, revocations, androidKeys, appAttest };
}

function register(androidKeys: AndroidKeyAttestService, store: AppAttestStore, chain: AndroidChain, owner = user) {
  store.addChallenge(chain.challenge, owner.id);
  return androidKeys.registerKey(owner, {
    keyId: chain.keyId,
    certificateChain: chain.chain.map((der) => der.toString('base64')),
    challenge: chain.challenge,
  });
}

function signed(
  chain: AndroidChain,
  options: { nonce?: string | null; timestamp?: number; method?: string; body?: Buffer; signedBody?: Buffer; signedUrl?: string } = {},
): AttestedRequest {
  const timestamp = String(options.timestamp ?? Date.now());
  const method = options.method ?? 'GET';
  const body = options.body ?? Buffer.alloc(0);
  const nonce = options.nonce === undefined ? randomBytes(16).toString('base64url') : options.nonce;
  const clientData = androidAttestClientData(
    method,
    options.signedUrl ?? url,
    timestamp,
    appAttestBodySha256(options.signedBody ?? body),
    nonce ?? '',
  );
  return {
    method,
    url,
    body,
    headers: {
      [APP_ATTEST_HEADERS.keyId]: chain.keyId,
      [APP_ATTEST_HEADERS.assertion]: androidAssertion(clientData, chain.leafKey).toString('base64'),
      [APP_ATTEST_HEADERS.timestamp]: timestamp,
      ...(nonce === null ? {} : { [APP_ATTEST_HEADERS.nonce]: nonce }),
    },
  };
}

async function errorCode(fn: () => unknown): Promise<string | undefined> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ForbiddenException || error instanceof BadRequestException) return (error.getResponse() as { errorCode?: string }).errorCode;
    throw error;
  }
  return undefined;
}

describe('androidAttestClientData', () => {
  it('signs the same bytes the Android app builds', () => {
    // The same vector is asserted by the app's `AttestClientDataTest`.
    const bytes = androidAttestClientData(
      'get',
      '/books/api/v1/notebook/overview?libraryIds=1',
      '1762560000000',
      appAttestBodySha256(Buffer.alloc(0)),
      'AAAAAAAAAAAAAAAAAAAAAA',
    );
    expect(bytes.toString()).toBe(
      'bookorbit-android-attest-v1\nGET\n/api/v1/notebook/overview?libraryIds=1\n1762560000000\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\nAAAAAAAAAAAAAAAAAAAAAA',
    );
  });
});

describe('AndroidKeyAttestService', () => {
  it('registers a key once per challenge', async () => {
    const { chain, store, androidKeys, appAttest } = setup();

    await expect(register(androidKeys, store, chain)).resolves.toEqual({ keyId: chain.keyId, environment: 'production' });
    expect(appAttest.listKeys(user)).toEqual([expect.objectContaining({ keyId: chain.keyId, platform: 'android', environment: 'production' })]);

    const reuse = androidKeys.registerKey(user, {
      keyId: chain.keyId,
      certificateChain: chain.chain.map((der) => der.toString('base64')),
      challenge: chain.challenge,
    });
    expect(await errorCode(() => reuse)).toBe('APP_ATTEST_INVALID');
  });

  it('refuses a challenge issued to someone else', async () => {
    const { chain, store, androidKeys } = setup();
    store.addChallenge(chain.challenge, otherUser.id);
    const attempt = androidKeys.registerKey(user, {
      keyId: chain.keyId,
      certificateChain: chain.chain.map((der) => der.toString('base64')),
      challenge: chain.challenge,
    });
    expect(await errorCode(() => attempt)).toBe('APP_ATTEST_INVALID');
  });

  it('refuses a chain with a revoked certificate', async () => {
    const { chain, store, revocations, androidKeys } = setup();
    revocations.revoked.add('2002');
    expect(await errorCode(() => register(androidKeys, store, chain))).toBe('APP_ATTEST_INVALID');
    expect(store.keysForUser(user.id)).toEqual([]);
  });

  it('refuses an attestation that does not verify', async () => {
    const { store, androidKeys } = setup();
    const stranger = androidChain();
    expect(await errorCode(() => register(androidKeys, store, stranger))).toBe('APP_ATTEST_INVALID');
  });
});

describe('AppAttestService with an Android key', () => {
  async function registered() {
    const context = setup();
    await register(context.androidKeys, context.store, context.chain);
    return context;
  }

  it('accepts a signed request without a body and one with a body', async () => {
    const { chain, appAttest } = await registered();
    expect(() => appAttest.verifyRequest(user, signed(chain))).not.toThrow();
    expect(() => appAttest.verifyRequest(user, signed(chain, { method: 'POST', body: Buffer.from('{"rating":4}') }))).not.toThrow();
  });

  it('refuses a request with no nonce as unsigned', async () => {
    const { chain, appAttest } = await registered();
    expect(await errorCode(() => appAttest.verifyRequest(user, signed(chain, { nonce: null })))).toBe('APP_ATTEST_REQUIRED');
  });

  it('refuses a replayed nonce', async () => {
    const { chain, appAttest } = await registered();
    const request = signed(chain);
    appAttest.verifyRequest(user, request);
    expect(await errorCode(() => appAttest.verifyRequest(user, request))).toBe('APP_ATTEST_INVALID');
  });

  it('refuses a malformed nonce', async () => {
    const { chain, appAttest } = await registered();
    expect(await errorCode(() => appAttest.verifyRequest(user, signed(chain, { nonce: 'bad nonce' })))).toBe('APP_ATTEST_INVALID');
  });

  it('refuses a stale request, another body and another path', async () => {
    const { chain, appAttest } = await registered();
    expect(await errorCode(() => appAttest.verifyRequest(user, signed(chain, { timestamp: Date.now() - 6 * 60_000 })))).toBe('APP_ATTEST_INVALID');
    expect(
      await errorCode(() =>
        appAttest.verifyRequest(user, signed(chain, { method: 'POST', body: Buffer.from('{"a":2}'), signedBody: Buffer.from('{"a":1}') })),
      ),
    ).toBe('APP_ATTEST_INVALID');
    expect(await errorCode(() => appAttest.verifyRequest(user, signed(chain, { signedUrl: '/api/v1/notebook/books' })))).toBe('APP_ATTEST_INVALID');
  });

  it('refuses a request a failed signature never used, so its nonce stays fresh', async () => {
    const { chain, appAttest } = await registered();
    const nonce = randomBytes(16).toString('base64url');
    expect(await errorCode(() => appAttest.verifyRequest(user, signed(chain, { nonce, signedUrl: '/api/v1/other' })))).toBe('APP_ATTEST_INVALID');
    expect(() => appAttest.verifyRequest(user, signed(chain, { nonce }))).not.toThrow();
  });

  it("refuses another account's key", async () => {
    const { chain, appAttest } = await registered();
    expect(await errorCode(() => appAttest.verifyRequest(otherUser, signed(chain)))).toBe('APP_ATTEST_KEY_UNKNOWN');
  });
});
