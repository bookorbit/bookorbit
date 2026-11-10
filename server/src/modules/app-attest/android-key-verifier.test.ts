import { createHash, X509Certificate } from 'node:crypto';

import { VERIFIED_BOOT_STATE } from './android-key-description';
import { verifyAndroidAssertion, verifyAndroidAttestation, type AndroidAttestationPolicy } from './android-key-verifier';
import { AppAttestVerificationError } from './app-attest-verifier';
import { androidKeyAttestPolicy, BOOKORBIT_ANDROID_DEBUG_PACKAGE } from './app-attest.policy';
import { GOOGLE_KEY_ATTESTATION_ROOTS } from './google-attestation-roots';
import {
  androidAssertion,
  androidChain,
  FIXTURE_PACKAGE,
  FIXTURE_SIGNATURE_DIGEST,
  type AndroidChain,
  type AndroidChainSpec,
} from './test-fixtures/android-attestation-test-helpers';
import { EMULATOR_CHAIN_FIXTURE } from './test-fixtures/android-emulator-chain';

function productionPolicy(chain: AndroidChain): AndroidAttestationPolicy {
  return {
    apps: [{ packageName: FIXTURE_PACKAGE, signatureDigests: [FIXTURE_SIGNATURE_DIGEST.toString('hex')], development: false }],
    trustedRoots: [chain.rootPem],
    allowDevelopment: false,
  };
}

function verify(spec: AndroidChainSpec = {}, policy?: (chain: AndroidChain) => AndroidAttestationPolicy) {
  const chain = androidChain(spec);
  return verifyAndroidAttestation(
    { keyId: chain.keyId, chain: chain.chain, challenge: Buffer.from(chain.challenge) },
    (policy ?? productionPolicy)(chain),
  );
}

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppAttestVerificationError) return error.reason;
    throw error;
  }
  return 'accepted';
}

describe('verifyAndroidAttestation', () => {
  it('accepts a hardware key of the official app on a verified phone', () => {
    const chain = androidChain();
    const attested = verifyAndroidAttestation(
      { keyId: chain.keyId, chain: chain.chain, challenge: Buffer.from(chain.challenge) },
      productionPolicy(chain),
    );

    expect(attested).toEqual(
      expect.objectContaining({ keyId: chain.keyId, appId: FIXTURE_PACKAGE, environment: 'production', revocableSerials: chain.serials }),
    );
    expect(attested.publicKeyPem).toContain('BEGIN PUBLIC KEY');
  });

  it('accepts a chain that stops below its root', () => {
    expect(reason(() => verify({ includeRoot: false }))).toBe('accepted');
  });

  it('accepts a locked phone on a self-signed OS, and refuses one left unlocked', () => {
    expect(reason(() => verify({ verifiedBootState: VERIFIED_BOOT_STATE.selfSigned, deviceLocked: true }))).toBe('accepted');
    expect(reason(() => verify({ verifiedBootState: VERIFIED_BOOT_STATE.selfSigned, deviceLocked: false }))).toBe('device boot is not verified');
  });

  it.each([
    ['an unverified boot', { verifiedBootState: VERIFIED_BOOT_STATE.unverified }, 'device boot is not verified'],
    ['a failed boot', { verifiedBootState: VERIFIED_BOOT_STATE.failed }, 'device boot is not verified'],
    ['a software keystore', { securityLevel: 0, softwareOnly: true }, 'key is not hardware backed'],
    ['another package', { packageName: 'com.example.reader' }, 'app id is not allowed'],
    ['another signing certificate', { signatureDigest: Buffer.alloc(32, 1) }, 'app id is not allowed'],
    ['no application id', { withoutApplicationId: true }, 'attestation names no application'],
    ['an imported key', { origin: 2 }, 'attested key was not generated in the keystore'],
    ['a key that cannot sign', { purposes: [0] }, 'attested key cannot sign'],
    ['an RSA key', { algorithm: 1 }, 'attested key is not EC'],
    ['another curve', { ecCurve: 2 }, 'attested key is not P-256'],
    ['an expired intermediate', { intermediateNotAfter: new Date('2021-01-01T00:00:00Z') }, 'certificate is outside its validity period'],
    ['a broken link', { brokenLink: true }, 'a certificate is not signed by the next'],
  ] as const)('refuses %s', (_name, spec, expected) => {
    expect(reason(() => verify(spec))).toBe(expected);
  });

  it('refuses another challenge', () => {
    const chain = androidChain();
    expect(
      reason(() => verifyAndroidAttestation({ keyId: chain.keyId, chain: chain.chain, challenge: Buffer.from('another') }, productionPolicy(chain))),
    ).toBe('challenge mismatch');
  });

  it('refuses a key id that is not the attested key', () => {
    const chain = androidChain();
    const other = androidChain();
    expect(
      reason(() =>
        verifyAndroidAttestation({ keyId: other.keyId, chain: chain.chain, challenge: Buffer.from(chain.challenge) }, productionPolicy(chain)),
      ),
    ).toBe('key id does not match the attested key');
  });

  it('refuses a chain that reaches no trusted root in production', () => {
    expect(reason(() => verify({}, (chain) => ({ ...productionPolicy(chain), trustedRoots: GOOGLE_KEY_ATTESTATION_ROOTS })))).toBe(
      'certificate chain does not reach a trusted root',
    );
  });

  it('refuses a short chain and a malformed certificate', () => {
    const chain = androidChain();
    expect(
      reason(() =>
        verifyAndroidAttestation({ keyId: chain.keyId, chain: [chain.chain[0]], challenge: Buffer.from(chain.challenge) }, productionPolicy(chain)),
      ),
    ).toBe('unexpected chain length');
    expect(
      reason(() =>
        verifyAndroidAttestation(
          { keyId: chain.keyId, chain: [Buffer.from('nope'), chain.chain[1]], challenge: Buffer.from(chain.challenge) },
          productionPolicy(chain),
        ),
      ),
    ).toBe('malformed certificate');
  });

  it('accepts a development build and a software keystore only outside production', () => {
    const development = () => androidKeyAttestPolicy('development');
    const debug = {
      packageName: BOOKORBIT_ANDROID_DEBUG_PACKAGE,
      securityLevel: 0,
      softwareOnly: true,
      verifiedBootState: VERIFIED_BOOT_STATE.unverified,
      deviceLocked: false,
    };

    const attested = verify(debug, development);
    expect(attested).toEqual(expect.objectContaining({ appId: BOOKORBIT_ANDROID_DEBUG_PACKAGE, environment: 'development', revocableSerials: [] }));

    const production = (chain: AndroidChain) => ({ ...androidKeyAttestPolicy('production'), trustedRoots: [chain.rootPem] });
    expect(reason(() => verify({ ...debug }, production))).toBe('key is not hardware backed');
    expect(reason(() => verify({ packageName: BOOKORBIT_ANDROID_DEBUG_PACKAGE }, production))).toBe('app id is not allowed');
  });

  it('accepts no release build until its signing certificates are listed', () => {
    expect(reason(() => verify({}, (chain) => ({ ...androidKeyAttestPolicy('production'), trustedRoots: [chain.rootPem] })))).toBe(
      'app id is not allowed',
    );
  });
});

describe('the emulator chain', () => {
  const fixture = EMULATOR_CHAIN_FIXTURE;
  const chain = fixture.pems.map((pem) => Buffer.from(new X509Certificate(pem).raw));
  const keyIdOf = () => {
    const jwk = new X509Certificate(fixture.pems[0]).publicKey.export({ format: 'jwk' });
    const point = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]);
    return createHash('sha256').update(point).digest('base64');
  };

  it('passes the development policy at its capture time', () => {
    const attested = verifyAndroidAttestation(
      { keyId: keyIdOf(), chain, challenge: Buffer.from(fixture.challenge) },
      {
        apps: [{ packageName: fixture.packageName, signatureDigests: 'any', development: true }],
        trustedRoots: GOOGLE_KEY_ATTESTATION_ROOTS,
        allowDevelopment: true,
        now: fixture.capturedAt,
      },
    );
    expect(attested).toEqual(expect.objectContaining({ appId: fixture.packageName, environment: 'development', revocableSerials: [] }));
  });

  it('is refused in production', () => {
    expect(
      reason(() =>
        verifyAndroidAttestation(
          { keyId: keyIdOf(), chain, challenge: Buffer.from(fixture.challenge) },
          { ...androidKeyAttestPolicy('production'), now: fixture.capturedAt },
        ),
      ),
    ).toBe('certificate chain does not reach a trusted root');
  });
});

describe('Google attestation roots', () => {
  it('are two current CA certificates', () => {
    const now = new Date();
    for (const pem of GOOGLE_KEY_ATTESTATION_ROOTS) {
      const root = new X509Certificate(pem);
      expect(root.ca).toBe(true);
      expect(new Date(root.validTo) > now).toBe(true);
    }
    expect(GOOGLE_KEY_ATTESTATION_ROOTS).toHaveLength(2);
  });
});

describe('verifyAndroidAssertion', () => {
  it('accepts a signature over the client data and nothing else', () => {
    const chain = androidChain();
    const attested = verifyAndroidAttestation(
      { keyId: chain.keyId, chain: chain.chain, challenge: Buffer.from(chain.challenge) },
      productionPolicy(chain),
    );
    const clientData = Buffer.from('bookorbit-android-attest-v1\nGET\n/api/v1/notebook/overview');
    const signature = androidAssertion(clientData, chain.leafKey);

    expect(() => verifyAndroidAssertion({ signature, clientData, publicKeyPem: attested.publicKeyPem })).not.toThrow();
    expect(() => verifyAndroidAssertion({ signature, clientData: Buffer.from('changed'), publicKeyPem: attested.publicKeyPem })).toThrow(
      'assertion signature is invalid',
    );
  });
});
