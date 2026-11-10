import { randomBytes, createHash } from 'node:crypto';

import { BadRequestException, ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { RequestUser } from '../../common/types/request-user';
import { AppAttestVerificationError, verifyAssertion, verifyAttestation, type AppAttestEnvironment } from './app-attest-verifier';
import { verifyAndroidAssertion } from './android-key-verifier';
import { acceptNonce, isFreshNonce } from './android-nonces';
import { acceptCounter, isFreshCounter } from './app-attest-counter';
import { APP_ATTEST_POLICY, type AppAttestPolicy } from './app-attest.policy';
import { AppAttestStore, type StoredAppAttestKey } from './app-attest.store';
import type { RegisterAppAttestKeyDto } from './dto/register-app-attest-key.dto';

export const APP_ATTEST_HEADERS = {
  keyId: 'x-bookorbit-attest-key',
  assertion: 'x-bookorbit-attest-assertion',
  timestamp: 'x-bookorbit-attest-time',
  /** Android only: a fresh value per request, since an Android key keeps no counter. */
  nonce: 'x-bookorbit-attest-nonce',
} as const;

export const APP_ATTEST_ERROR_CODES = {
  required: 'APP_ATTEST_REQUIRED',
  unknownKey: 'APP_ATTEST_KEY_UNKNOWN',
  invalid: 'APP_ATTEST_INVALID',
} as const;

const CLIENT_DATA_VERSION = 'bookorbit-app-attest-v1';
const ANDROID_CLIENT_DATA_VERSION = 'bookorbit-android-attest-v1';
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

export const appAttestBodySha256 = (body: Buffer): string => createHash('sha256').update(body).digest('hex');
const EMPTY_BODY_SHA256 = appAttestBodySha256(Buffer.alloc(0));

export interface AttestedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  /** The raw bytes the client sent, empty for a bodyless request, or null when they are unavailable (for example multipart). */
  body: Buffer | null;
}

/**
 * The exact bytes the app signs for one request: the method, the path from `/api/v1` on (so a
 * reverse proxy that mounts BookOrbit under a prefix does not change what either side computes),
 * the timestamp, and the lowercase hex SHA-256 of the raw request body.
 */
export function appAttestClientData(method: string, url: string, timestamp: string, bodySha256 = EMPTY_BODY_SHA256): Buffer {
  const at = url.indexOf('/api/v1/');
  const path = at >= 0 ? url.slice(at) : url;
  return Buffer.from([CLIENT_DATA_VERSION, method.toUpperCase(), path, timestamp, bodySha256].join('\n'));
}

/** What the Android app signs: the same lines under its own version, then the request's nonce. */
export function androidAttestClientData(method: string, url: string, timestamp: string, bodySha256: string, nonce: string): Buffer {
  const at = url.indexOf('/api/v1/');
  const path = at >= 0 ? url.slice(at) : url;
  return Buffer.from([ANDROID_CLIENT_DATA_VERSION, method.toUpperCase(), path, timestamp, bodySha256, nonce].join('\n'));
}

@Injectable()
export class AppAttestService {
  private readonly logger = new Logger(AppAttestService.name);

  constructor(
    @Inject(APP_ATTEST_POLICY) private readonly policy: AppAttestPolicy,
    private readonly store: AppAttestStore,
  ) {}

  issueChallenge(user: RequestUser): { challenge: string; expiresAt: string } {
    const challenge = randomBytes(32).toString('base64url');
    const expiresAt = this.store.addChallenge(challenge, user.id);
    return { challenge, expiresAt: expiresAt.toISOString() };
  }

  registerKey(user: RequestUser, dto: RegisterAppAttestKeyDto): { keyId: string; environment: AppAttestEnvironment } {
    const startedAt = Date.now();
    if (!this.store.consumeChallenge(dto.challenge, user.id)) {
      throw new BadRequestException({ message: 'Unknown or expired App Attest challenge', errorCode: APP_ATTEST_ERROR_CODES.invalid });
    }
    try {
      const attested = verifyAttestation(
        { keyId: dto.keyId, attestation: Buffer.from(dto.attestation, 'base64'), challenge: Buffer.from(dto.challenge) },
        this.policy,
      );
      this.store.saveKey({ ...attested, userId: user.id, counter: 0, recentCounters: new Set(), registeredAt: new Date() });
      this.logger.debug(
        `[app-attest.register] [end] userId=${user.id} keyId=${attested.keyId} environment=${attested.environment} durationMs=${Date.now() - startedAt} - key registered`,
      );
      return { keyId: attested.keyId, environment: attested.environment };
    } catch (error) {
      if (!(error instanceof AppAttestVerificationError)) throw error;
      this.logger.debug(
        `[app-attest.register] [fail] userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${error.name} error="${sanitizeLogValue(error.reason)}" - attestation rejected`,
      );
      throw new BadRequestException({ message: 'App Attest attestation was rejected', errorCode: APP_ATTEST_ERROR_CODES.invalid });
    }
  }

  listKeys(user: RequestUser) {
    return this.store.keysForUser(user.id).map(({ keyId, environment, platform, counter, registeredAt, lastAssertionAt }) => ({
      keyId,
      environment,
      platform: platform ?? 'ios',
      counter,
      registeredAt: registeredAt.toISOString(),
      lastAssertionAt: lastAssertionAt?.toISOString() ?? null,
    }));
  }

  /** Throws a 403 with a stable code, never a 401: a 401 makes the app refresh and can end its session. */
  verifyRequest(user: RequestUser, request: AttestedRequest): void {
    const keyId = header(request, APP_ATTEST_HEADERS.keyId);
    const assertion = header(request, APP_ATTEST_HEADERS.assertion);
    const timestamp = header(request, APP_ATTEST_HEADERS.timestamp);
    if (!keyId || !assertion || !timestamp) throw refusal(APP_ATTEST_ERROR_CODES.required, 'This route requires App Attest');

    const key = this.store.findKey(keyId);
    if (!key || key.userId !== user.id) throw refusal(APP_ATTEST_ERROR_CODES.unknownKey, 'Unknown App Attest key');

    const sentAt = Number(timestamp);
    if (!Number.isSafeInteger(sentAt) || Math.abs(Date.now() - sentAt) > MAX_CLOCK_SKEW_MS || request.body === null) {
      throw refusal(APP_ATTEST_ERROR_CODES.invalid, 'App Attest assertion is stale or unsupported for this request');
    }
    if (key.platform === 'android') {
      this.verifyAndroidRequest(user, key, request, { assertion, timestamp, sentAt, body: request.body });
      return;
    }

    try {
      const result = verifyAssertion({
        assertion: Buffer.from(assertion, 'base64'),
        clientData: appAttestClientData(request.method, request.url, timestamp, appAttestBodySha256(request.body)),
        publicKeyPem: key.publicKeyPem,
        appId: key.appId,
        isFreshCounter: (counter) => isFreshCounter(key, counter),
      });
      acceptCounter(key, result.counter);
      key.lastAssertionAt = new Date();
      this.logger.debug(`[app-attest.assert] [end] userId=${user.id} keyId=${key.keyId} counter=${result.counter} - assertion verified`);
    } catch (error) {
      if (!(error instanceof AppAttestVerificationError)) throw error;
      this.logger.debug(
        `[app-attest.assert] [fail] userId=${user.id} keyId=${key.keyId} errorClass=${error.name} error="${sanitizeLogValue(error.reason)}" - assertion rejected`,
      );
      throw refusal(APP_ATTEST_ERROR_CODES.invalid, 'App Attest assertion was rejected');
    }
  }

  private verifyAndroidRequest(
    user: RequestUser,
    key: StoredAppAttestKey,
    request: AttestedRequest,
    signed: { assertion: string; timestamp: string; sentAt: number; body: Buffer },
  ): void {
    const nonce = header(request, APP_ATTEST_HEADERS.nonce);
    if (!nonce) throw refusal(APP_ATTEST_ERROR_CODES.required, 'This route requires App Attest');
    try {
      if (!isFreshNonce(key, nonce)) throw new AppAttestVerificationError('nonce was already used or is malformed');
      verifyAndroidAssertion({
        signature: Buffer.from(signed.assertion, 'base64'),
        clientData: androidAttestClientData(request.method, request.url, signed.timestamp, appAttestBodySha256(signed.body), nonce),
        publicKeyPem: key.publicKeyPem,
      });
      acceptNonce(key, nonce, signed.sentAt, MAX_CLOCK_SKEW_MS);
      key.lastAssertionAt = new Date();
      this.logger.debug(`[app-attest.assert] [end] userId=${user.id} keyId=${key.keyId} platform=android - assertion verified`);
    } catch (error) {
      if (!(error instanceof AppAttestVerificationError)) throw error;
      this.logger.debug(
        `[app-attest.assert] [fail] userId=${user.id} keyId=${key.keyId} platform=android errorClass=${error.name} error="${sanitizeLogValue(error.reason)}" - assertion rejected`,
      );
      throw refusal(APP_ATTEST_ERROR_CODES.invalid, 'App Attest assertion was rejected');
    }
  }
}

function header(request: AttestedRequest, name: string): string | undefined {
  const value = request.headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

function refusal(errorCode: string, message: string): ForbiddenException {
  return new ForbiddenException({ message, errorCode });
}
