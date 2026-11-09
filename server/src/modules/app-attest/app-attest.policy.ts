import type { AndroidAttestationPolicy } from './android-key-verifier';
import { APPLE_APP_ATTESTATION_ROOT_CA } from './apple-app-attestation-root';
import { GOOGLE_KEY_ATTESTATION_ROOTS } from './google-attestation-roots';

/** The official BookOrbit iOS app (Team ID plus bundle ID). Deliberately not configurable. */
export const BOOKORBIT_IOS_APP_ID = 'S5KR7ABWBZ.app.bookorbit.reader';

/** The official BookOrbit Android app. Deliberately not configurable. */
export const BOOKORBIT_ANDROID_PACKAGE = 'app.bookorbit.reader';
export const BOOKORBIT_ANDROID_DEBUG_PACKAGE = 'app.bookorbit.reader.debug';

/**
 * SHA-256 of the certificates the release app is signed with, lowercase hex: Play App Signing's,
 * for a build from Play, and the upload key's, for a release build the owner installs. Empty until
 * the app is in Play Console, so until then a production server accepts no Android key.
 */
export const BOOKORBIT_ANDROID_RELEASE_DIGESTS: readonly string[] = [];

export const ANDROID_KEY_ATTEST_POLICY = Symbol('ANDROID_KEY_ATTEST_POLICY');

export function androidKeyAttestPolicy(nodeEnv: string): AndroidAttestationPolicy {
  const production = nodeEnv === 'production';
  return {
    apps: [
      { packageName: BOOKORBIT_ANDROID_PACKAGE, signatureDigests: BOOKORBIT_ANDROID_RELEASE_DIGESTS, development: false },
      // Any machine's debug build, and the emulator: forgeable, so never on a production server.
      ...(production ? [] : [{ packageName: BOOKORBIT_ANDROID_DEBUG_PACKAGE, signatureDigests: 'any' as const, development: true }]),
    ],
    trustedRoots: GOOGLE_KEY_ATTESTATION_ROOTS,
    allowDevelopment: !production,
  };
}

export const APP_ATTEST_POLICY = Symbol('APP_ATTEST_POLICY');

export interface AppAttestPolicy {
  appIds: readonly string[];
  allowDevelopment: boolean;
  trustedRoots: readonly string[];
}

export function appAttestPolicy(nodeEnv: string): AppAttestPolicy {
  return {
    appIds: [BOOKORBIT_IOS_APP_ID],
    // Development attestations come only from builds our team signs; production refuses them anyway.
    allowDevelopment: nodeEnv !== 'production',
    trustedRoots: [APPLE_APP_ATTESTATION_ROOT_CA],
  };
}
