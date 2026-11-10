import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { RequestUser } from '../../common/types/request-user';
import { verifyAndroidAttestation, type AndroidAttestationPolicy } from './android-key-verifier';
import { AppAttestVerificationError, type AppAttestEnvironment } from './app-attest-verifier';
import { ANDROID_KEY_ATTEST_POLICY } from './app-attest.policy';
import { APP_ATTEST_ERROR_CODES } from './app-attest.service';
import { AppAttestStore } from './app-attest.store';
import { AttestationRevocations } from './attestation-revocations';
import type { RegisterAndroidKeyDto } from './dto/register-android-key.dto';

/** Registers an Android Key Attestation key; its requests are checked by `AppAttestService` like iOS's. */
@Injectable()
export class AndroidKeyAttestService {
  private readonly logger = new Logger(AndroidKeyAttestService.name);

  constructor(
    @Inject(ANDROID_KEY_ATTEST_POLICY) private readonly policy: AndroidAttestationPolicy,
    private readonly store: AppAttestStore,
    private readonly revocations: AttestationRevocations,
  ) {}

  async registerKey(user: RequestUser, dto: RegisterAndroidKeyDto): Promise<{ keyId: string; environment: AppAttestEnvironment }> {
    const startedAt = Date.now();
    if (!this.store.consumeChallenge(dto.challenge, user.id)) {
      throw new BadRequestException({ message: 'Unknown or expired App Attest challenge', errorCode: APP_ATTEST_ERROR_CODES.invalid });
    }
    try {
      const attested = verifyAndroidAttestation(
        {
          keyId: dto.keyId,
          chain: dto.certificateChain.map((certificate) => Buffer.from(certificate, 'base64')),
          challenge: Buffer.from(dto.challenge),
        },
        this.policy,
      );
      if (await this.revocations.anyRevoked(attested.revocableSerials)) throw new AppAttestVerificationError('a certificate in the chain is revoked');
      const key = { keyId: attested.keyId, publicKeyPem: attested.publicKeyPem, appId: attested.appId, environment: attested.environment };
      this.store.saveKey({ ...key, userId: user.id, platform: 'android', counter: 0, recentCounters: new Set(), registeredAt: new Date() });
      this.logger.debug(
        `[app-attest.register] [end] userId=${user.id} keyId=${key.keyId} platform=android environment=${key.environment} durationMs=${Date.now() - startedAt} - key registered`,
      );
      return { keyId: key.keyId, environment: key.environment };
    } catch (error) {
      if (!(error instanceof AppAttestVerificationError)) throw error;
      this.logger.debug(
        `[app-attest.register] [fail] userId=${user.id} platform=android durationMs=${Date.now() - startedAt} errorClass=${error.name} error="${sanitizeLogValue(error.reason)}" - attestation rejected`,
      );
      throw new BadRequestException({ message: 'App Attest attestation was rejected', errorCode: APP_ATTEST_ERROR_CODES.invalid });
    }
  }
}
