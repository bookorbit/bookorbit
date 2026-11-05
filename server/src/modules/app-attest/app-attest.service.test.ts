import { BadRequestException, ForbiddenException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { APP_ATTEST_HEADERS, AppAttestService, appAttestBodySha256, appAttestClientData, type AttestedRequest } from './app-attest.service';
import { appAttestPolicy, BOOKORBIT_IOS_APP_ID } from './app-attest.policy';
import { AppAttestStore } from './app-attest.store';
import { ATTESTATION_FIXTURE } from './test-fixtures/attestation-fixture';
import { fixtureAssertion, fixtureAttestation } from './test-fixtures/app-attest-test-helpers';

const fixture = ATTESTATION_FIXTURE;
const user = { id: 7 } as RequestUser;
const otherUser = { id: 8 } as RequestUser;
const url = '/api/v1/notebook/overview?libraryIds=1';

function setup() {
  const store = new AppAttestStore();
  const service = new AppAttestService({ appIds: [fixture.appId], allowDevelopment: true, trustedRoots: [fixture.rootPem] }, store);
  return { store, service };
}

function register(service: AppAttestService, store: AppAttestStore, owner = user) {
  store.addChallenge(fixture.challenge, owner.id);
  return service.registerKey(owner, { keyId: fixture.keyId, attestation: fixtureAttestation().toString('base64'), challenge: fixture.challenge });
}

function signedRequest(
  counter: number,
  options: { timestamp?: number; requestUrl?: string; signedUrl?: string; method?: string; body?: Buffer } = {},
): AttestedRequest {
  const timestamp = String(options.timestamp ?? Date.now());
  const method = options.method ?? 'GET';
  const body = options.body ?? Buffer.alloc(0);
  const clientData = appAttestClientData(method, options.signedUrl ?? url, timestamp, appAttestBodySha256(body));
  return {
    method,
    url: options.requestUrl ?? url,
    body,
    headers: {
      [APP_ATTEST_HEADERS.keyId]: fixture.keyId,
      [APP_ATTEST_HEADERS.assertion]: fixtureAssertion(clientData, counter).toString('base64'),
      [APP_ATTEST_HEADERS.timestamp]: timestamp,
    },
  };
}

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof ForbiddenException || error instanceof BadRequestException) return (error.getResponse() as { errorCode?: string }).errorCode;
    throw error;
  }
  return undefined;
}

describe('appAttestPolicy', () => {
  it('accepts only the official app and refuses development attestations in production', () => {
    expect(appAttestPolicy('production')).toEqual(expect.objectContaining({ appIds: [BOOKORBIT_IOS_APP_ID], allowDevelopment: false }));
    expect(appAttestPolicy('development').allowDevelopment).toBe(true);
    expect(appAttestPolicy('production').trustedRoots).toHaveLength(1);
  });
});

describe('appAttestClientData', () => {
  it('matches the bytes the iOS app signs', () => {
    expect(appAttestClientData('get', '/bookorbit/api/v1/notebook/overview?libraryIds=1', '1700000000000').toString()).toBe(
      'bookorbit-app-attest-v1\nGET\n/api/v1/notebook/overview?libraryIds=1\n1700000000000\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('binds the raw body bytes the same way the iOS app does', () => {
    const body = Buffer.from('{"settings":{"names":{"yellow":"Quotes"}}}');
    expect(appAttestBodySha256(body)).toBe('65636b46bfd2d1080290d6dfc5eb803cfd35e5d564dc614050845c5f32aa30e0');
    expect(appAttestClientData('PUT', '/api/v1/user-preferences/annotation-colors', '1700000000000', appAttestBodySha256(body)).toString()).toBe(
      'bookorbit-app-attest-v1\nPUT\n/api/v1/user-preferences/annotation-colors\n1700000000000\n65636b46bfd2d1080290d6dfc5eb803cfd35e5d564dc614050845c5f32aa30e0',
    );
  });
});

describe('AppAttestService', () => {
  it('issues single-use challenges bound to the user', () => {
    const { service, store } = setup();
    const { challenge } = service.issueChallenge(user);
    expect(store.consumeChallenge(challenge, otherUser.id)).toBe(false);
    const second = service.issueChallenge(user).challenge;
    expect(store.consumeChallenge(second, user.id)).toBe(true);
    expect(store.consumeChallenge(second, user.id)).toBe(false);
  });

  it('registers an attested key and verifies requests signed with it', () => {
    const { service, store } = setup();
    expect(register(service, store)).toEqual({ keyId: fixture.keyId, environment: 'development' });
    expect(errorCode(() => service.verifyRequest(user, signedRequest(1)))).toBeUndefined();
    expect(errorCode(() => service.verifyRequest(user, signedRequest(2)))).toBeUndefined();
    expect(service.listKeys(user)).toEqual([expect.objectContaining({ keyId: fixture.keyId, environment: 'development', counter: 2 })]);
    expect(service.listKeys(otherUser)).toEqual([]);
  });

  it('refuses a registration whose challenge was never issued', () => {
    const { service } = setup();
    expect(
      errorCode(() => service.registerKey(user, { keyId: fixture.keyId, attestation: fixtureAttestation().toString('base64'), challenge: 'x' })),
    ).toBe('APP_ATTEST_INVALID');
  });

  it('refuses a request that carries no assertion', () => {
    const unattested: AttestedRequest = { method: 'GET', url, body: Buffer.alloc(0), headers: {} };
    expect(errorCode(() => setup().service.verifyRequest(user, unattested))).toBe('APP_ATTEST_REQUIRED');
  });

  it('refuses replays, other paths, stale clocks and keys registered to someone else', () => {
    const { service, store } = setup();
    register(service, store);
    service.verifyRequest(user, signedRequest(5));
    expect(errorCode(() => service.verifyRequest(user, signedRequest(5)))).toBe('APP_ATTEST_INVALID');
    expect(errorCode(() => service.verifyRequest(user, signedRequest(6, { requestUrl: '/api/v1/notebook/overview?libraryIds=2' })))).toBe(
      'APP_ATTEST_INVALID',
    );
    expect(errorCode(() => service.verifyRequest(user, signedRequest(7, { timestamp: Date.now() - 10 * 60_000 })))).toBe('APP_ATTEST_INVALID');
    expect(errorCode(() => service.verifyRequest(otherUser, signedRequest(8)))).toBe('APP_ATTEST_KEY_UNKNOWN');
    expect(errorCode(() => setup().service.verifyRequest(user, signedRequest(9)))).toBe('APP_ATTEST_KEY_UNKNOWN');
  });

  it('accepts requests that arrive out of order once each, and refuses anything beyond the window', () => {
    const { service, store } = setup();
    register(service, store);
    const arrive = (counter: number) => errorCode(() => service.verifyRequest(user, signedRequest(counter)));
    expect(arrive(3)).toBeUndefined();
    expect(arrive(1)).toBeUndefined();
    expect(arrive(2)).toBeUndefined();
    expect(arrive(2)).toBe('APP_ATTEST_INVALID');
    expect(arrive(200)).toBeUndefined();
    expect(arrive(100)).toBe('APP_ATTEST_INVALID');
    expect(service.listKeys(user)).toEqual([expect.objectContaining({ counter: 200 })]);
  });

  it('signs the path from /api/v1 on, so a proxy prefix does not matter', () => {
    const { service, store } = setup();
    register(service, store);
    expect(errorCode(() => service.verifyRequest(user, signedRequest(1, { requestUrl: `/bookorbit${url}` })))).toBeUndefined();
  });

  it('binds an assertion to the exact request body', () => {
    const { service, store } = setup();
    register(service, store);
    const body = Buffer.from('{"settings":{"names":{"yellow":"Quotes"}}}');
    const put = (counter: number, sent: Buffer) => ({ ...signedRequest(counter, { method: 'PUT', body }), body: sent });
    expect(errorCode(() => service.verifyRequest(user, put(1, body)))).toBeUndefined();
    expect(errorCode(() => service.verifyRequest(user, put(2, Buffer.from('{"settings":{"names":{"yellow":"Other"}}}'))))).toBe('APP_ATTEST_INVALID');
    expect(errorCode(() => service.verifyRequest(user, put(3, Buffer.alloc(0))))).toBe('APP_ATTEST_INVALID');
  });

  it('refuses a body whose bytes are unavailable', () => {
    const { service, store } = setup();
    register(service, store);
    expect(errorCode(() => service.verifyRequest(user, { ...signedRequest(1, { method: 'POST' }), body: null }))).toBe('APP_ATTEST_INVALID');
  });
});
