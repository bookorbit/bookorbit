import { randomBytes } from 'node:crypto';

import { GUARDS_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';

import { AppAttestGuard } from '../src/modules/app-attest/app-attest.guard';
import { androidAttestClientData, appAttestBodySha256 } from '../src/modules/app-attest/app-attest.service';
import { androidAssertion, androidChain } from '../src/modules/app-attest/test-fixtures/android-attestation-test-helpers';
import { closeE2EContext, createE2EContext, type E2EContext } from './e2e/app-harness';

const TIMEOUT = 120_000;
const ID = '0b6c1f0e-8d3a-4c43-9f0f-2a5f2f1d7c11';

/**
 * Every route only the mobile apps call. Adding or removing one means changing `AppAttestPolicy` in
 * the iOS app and `AttestedRoutes` in the Android app in the same release: a route an app does not
 * sign is refused, and a signed route the server does not guard gains nothing.
 */
const GUARDED_ROUTES: Array<[method: string, path: string]> = [
  ['GET', '/notebook/entries'],
  ['GET', '/notebook/overview'],
  ['GET', '/notebook/books'],
  ['GET', '/notebook/review'],
  ['GET', '/notebook/on-this-day'],
  ['POST', '/dashboard/refresh'],
  ['GET', '/dashboard/widgets/reading-goal'],
  ['GET', '/dashboard/widgets/currently-reading'],
  ['GET', '/dashboard/widgets/reading-streak'],
  ['GET', '/dashboard/widgets/highlight-of-the-day'],
  ['GET', '/dashboard/widgets/highlights'],
  ['GET', '/dashboard/widgets/monthly-challenge'],
  ['GET', '/dashboard/widgets/year-projection'],
  ['GET', '/dashboard/widgets/reading-rhythm'],
  ['GET', '/user-statistics/activity-overview'],
  ['GET', '/user-statistics/activity-calendar/2026'],
  ['GET', '/user-statistics/activity-days/2026-11-05'],
  ['GET', '/user-statistics/activity-details/session-patterns'],
  ['GET', '/user-statistics/activity-details/completion-speed'],
  ['GET', '/user-statistics/activity-details/genre-time'],
  ['GET', '/user-statistics/activity-details/pace'],
  ['GET', '/smart-scopes/1/books'],
  ['GET', '/books/1/journal'],
  ['POST', '/books/1/journal'],
  ['PATCH', `/books/1/journal/${ID}`],
  ['DELETE', `/books/1/journal/${ID}`],
  ['POST', `/books/1/journal/${ID}/restore`],
  ['DELETE', `/books/1/journal/${ID}/permanent`],
  ['GET', '/user-preferences/annotation-colors'],
  ['PUT', '/user-preferences/annotation-colors'],
  ['GET', '/uploads/capabilities'],
  ['POST', '/uploads'],
  ['GET', `/uploads/${ID}`],
  ['POST', `/uploads/${ID}/complete`],
  ['DELETE', `/uploads/${ID}`],
  ['POST', '/achievements/celebrations/claim'],
  ['POST', `/achievements/celebrations/${ID}/acknowledge`],
  ['POST', '/tts/synthesize/captioned'],
  ['POST', '/watch-downloads'],
  ['POST', '/watch-downloads/media-overlay'],
  ['POST', '/mobile/books/files/1/locate-text'],
  ['GET', '/mobile/year-review/2026'],
  ['POST', '/mobile/visual-match'],
  ['POST', '/mobile/shelf-match'],
  ['GET', '/mobile/books/1/story-edits'],
  ['PUT', `/mobile/books/1/story-edits/${ID}`],
];

const UNGUARDED_ROUTES: Array<[method: string, path: string]> = [
  ['GET', '/dashboard/widgets/library-overview'],
  ['GET', '/search?q=dune'],
  ['GET', '/notebook/trash'],
  ['GET', '/reading-history/summary'],
];

const THIRD_PARTY_PROGRESS_ROUTES: Array<[method: string, path: string]> = [
  ['GET', '/books/files/1/progress'],
  ['POST', '/books/files/1/progress'],
  ['DELETE', '/books/files/1/progress'],
];

describe('App Attest enforcement (e2e)', { timeout: TIMEOUT }, () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await createE2EContext({ isolateAppData: true, realAppAttest: true });
  });

  afterAll(async () => {
    await closeE2EContext(ctx);
  });

  function send(method: string, path: string, headers: Record<string, string> = {}) {
    const hasBody = method !== 'GET' && method !== 'DELETE';
    return ctx.app.inject({
      method: method as 'GET',
      url: `/api/v1${path}`,
      headers: { authorization: `Bearer ${ctx.adminToken}`, ...(hasBody ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(hasBody ? { payload: '{}' } : {}),
    });
  }

  it('refuses every guarded route that carries no assertion', async () => {
    const failures: string[] = [];
    for (const [method, path] of GUARDED_ROUTES) {
      const response = await send(method, path);
      const errorCode = (response.json() as { errorCode?: string }).errorCode;
      if (response.statusCode !== 403 || errorCode !== 'APP_ATTEST_REQUIRED')
        failures.push(`${method} ${path} -> ${response.statusCode} ${errorCode}`);
    }
    expect(failures).toEqual([]);
  });

  it('refuses a forged assertion on every guarded route', async () => {
    const forged = {
      'x-bookorbit-attest-key': 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      'x-bookorbit-attest-assertion': 'AAAA',
      'x-bookorbit-attest-time': String(Date.now()),
    };
    const failures: string[] = [];
    for (const [method, path] of GUARDED_ROUTES) {
      const response = await send(method, path, forged);
      const errorCode = (response.json() as { errorCode?: string }).errorCode;
      if (response.statusCode !== 403 || errorCode !== 'APP_ATTEST_KEY_UNKNOWN')
        failures.push(`${method} ${path} -> ${response.statusCode} ${errorCode}`);
    }
    expect(failures).toEqual([]);
  });

  it('leaves the routes the web client shares open', async () => {
    for (const [method, path] of UNGUARDED_ROUTES) {
      expect((await send(method, path)).statusCode, `${method} ${path}`).toBe(200);
    }
  });

  it('leaves per-file progress routes open to third-party clients', async () => {
    for (const [method, path] of THIRD_PARTY_PROGRESS_ROUTES) {
      expect((await send(method, path)).statusCode, `${method} ${path}`).not.toBe(403);
    }
  });

  it('guards exactly the routes listed here', () => {
    let guarded = 0;
    for (const module of ctx.app.get(ModulesContainer).values()) {
      for (const wrapper of module.controllers.values()) {
        const prototype = wrapper.metatype?.prototype as Record<string, unknown> | undefined;
        if (!prototype || !wrapper.metatype) continue;
        const classGuarded = hasAppAttestGuard(Reflect.getMetadata(GUARDS_METADATA, wrapper.metatype));
        for (const name of Object.getOwnPropertyNames(prototype)) {
          const handler = prototype[name];
          if (typeof handler !== 'function' || Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
          if (classGuarded || hasAppAttestGuard(Reflect.getMetadata(GUARDS_METADATA, handler))) guarded++;
        }
      }
    }
    expect(guarded).toBe(GUARDED_ROUTES.length);
  });

  it('accepts a registered Android key on a guarded route, once per nonce', async () => {
    const challenge = (
      await ctx.app.inject({ method: 'POST', url: '/api/v1/app-attest/challenges', headers: { authorization: `Bearer ${ctx.adminToken}` } })
    ).json() as {
      challenge: string;
    };
    // A server outside production takes the debug build's software attestation, as the emulator makes it.
    const chain = androidChain({
      challenge: Buffer.from(challenge.challenge),
      packageName: 'app.bookorbit.reader.debug',
      securityLevel: 0,
      softwareOnly: true,
    });
    const registration = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/app-attest/android-keys',
      headers: { authorization: `Bearer ${ctx.adminToken}`, 'content-type': 'application/json' },
      payload: { keyId: chain.keyId, certificateChain: chain.chain.map((der) => der.toString('base64')), challenge: challenge.challenge },
    });
    expect(registration.statusCode).toBe(201);
    expect(registration.json()).toEqual({ keyId: chain.keyId, environment: 'development' });

    const path = '/notebook/overview';
    const timestamp = String(Date.now());
    const nonce = randomBytes(16).toString('base64url');
    const clientData = androidAttestClientData('GET', `/api/v1${path}`, timestamp, appAttestBodySha256(Buffer.alloc(0)), nonce);
    const headers = {
      'x-bookorbit-attest-key': chain.keyId,
      'x-bookorbit-attest-assertion': androidAssertion(clientData, chain.leafKey).toString('base64'),
      'x-bookorbit-attest-time': timestamp,
      'x-bookorbit-attest-nonce': nonce,
    };

    expect((await send('GET', path, headers)).statusCode).toBe(200);
    const replay = await send('GET', path, headers);
    expect(replay.statusCode).toBe(403);
    expect((replay.json() as { errorCode?: string }).errorCode).toBe('APP_ATTEST_INVALID');
  });
});

function hasAppAttestGuard(guards: unknown): boolean {
  return Array.isArray(guards) && guards.some((guard) => guard === AppAttestGuard || guard?.constructor === AppAttestGuard);
}
