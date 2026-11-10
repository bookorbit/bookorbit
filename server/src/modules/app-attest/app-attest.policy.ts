import type { AndroidAttestationPolicy } from './android-key-verifier';
import { APPLE_APP_ATTESTATION_ROOT_CA } from './apple-app-attestation-root';
import { GOOGLE_KEY_ATTESTATION_ROOTS } from './google-attestation-roots';

/** The official BookOrbit iOS app (Team ID plus bundle ID). Deliberately not configurable. */
export const BOOKORBIT_IOS_APP_ID = 'S5KR7ABWBZ.app.bookorbit.reader';

/** The official BookOrbit Android app. Deliberately not configurable. */
export const BOOKORBIT_ANDROID_PACKAGE = 'app.bookorbit.reader';
export const BOOKORBIT_ANDROID_DEBUG_PACKAGE = 'app.bookorbit.reader.debug';

/**
 * SHA-256 of the certificates the release app is signed with, lowercase hex: Play App Signing's
 * keys, for a build from Play, and the upload key's, for a release build the owner installs. Read
 * from Play Console's App signing page on 2026-11-10; a key Play adds there is listed here before
 * it signs a build.
 */
export const BOOKORBIT_ANDROID_RELEASE_DIGESTS: readonly string[] = [
  // Play App Signing: the key in use and the previous keys.
  '012316fc783d25d118fdc13681f5f4ae388e7f1d12914f8ea74b8eab7dd2637e',
  'de6ee3afa930eb0d162846d22fb7c08f22159610ea17dcb1f340bd83509331cf',
  '3e59ca69776c7211636c8975e632fd8f3d86e45dca146904165aba7cc46dccc9',
  // The upload key.
  '49a23669832e9defc4bdbec975ae28c1c6337689dc2c81ca3b4a6cef2e4ff485',
];

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
