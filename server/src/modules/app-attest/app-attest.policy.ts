import { APPLE_APP_ATTESTATION_ROOT_CA } from './apple-app-attestation-root';

/** The official BookOrbit iOS app (Team ID plus bundle ID). Deliberately not configurable. */
export const BOOKORBIT_IOS_APP_ID = 'S5KR7ABWBZ.app.bookorbit.reader';

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
