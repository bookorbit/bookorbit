import { X509Certificate } from 'node:crypto';

import { APPLE_APP_ATTESTATION_ROOT_CA } from './apple-app-attestation-root';
import { verifyAssertion, verifyAttestation, type AttestationPolicy } from './app-attest-verifier';
import { ATTESTATION_FIXTURE } from './test-fixtures/attestation-fixture';
import { fixtureAssertion, fixtureAttestation } from './test-fixtures/app-attest-test-helpers';

const fixture = ATTESTATION_FIXTURE;
const policy: AttestationPolicy = { appIds: [fixture.appId], allowDevelopment: true, trustedRoots: [fixture.rootPem] };
const input = { keyId: fixture.keyId, attestation: fixtureAttestation(), challenge: Buffer.from(fixture.challenge) };

function attest(overrides: Partial<typeof input> = {}, policyOverrides: Partial<AttestationPolicy> = {}) {
  return () => verifyAttestation({ ...input, ...overrides }, { ...policy, ...policyOverrides });
}

describe('verifyAttestation', () => {
  it('accepts a chain to a trusted root that commits to the challenge, key and app id', () => {
    const attested = verifyAttestation(input, policy);
    expect(attested).toEqual(expect.objectContaining({ keyId: fixture.keyId, appId: fixture.appId, environment: 'development' }));
    expect(attested.publicKeyPem).toContain('BEGIN PUBLIC KEY');
  });

  it('pins the real Apple root by default', () => {
    expect(new X509Certificate(APPLE_APP_ATTESTATION_ROOT_CA).subject).toContain('Apple App Attestation Root CA');
    expect(attest({}, { trustedRoots: undefined })).toThrow('certificate chain does not reach a trusted root');
  });

  it('rejects a different challenge', () => {
    expect(attest({ challenge: Buffer.from('another-challenge') })).toThrow('nonce mismatch');
  });

  it('rejects a key id that is not the attested key', () => {
    expect(attest({ keyId: Buffer.alloc(32, 1).toString('base64') })).toThrow('key id does not match');
  });

  it('rejects an app id outside the allow list', () => {
    expect(attest({}, { appIds: ['OTHERTEAM1.app.bookorbit.test'] })).toThrow('app id is not allowed');
  });

  it('rejects development attestations unless allowed', () => {
    expect(attest({}, { allowDevelopment: false })).toThrow('development attestations are not accepted');
  });

  it('rejects tampered authenticator data, which no longer matches the certified nonce', () => {
    const authData = Buffer.from(fixture.authDataHex, 'hex');
    authData[36] = 1;
    expect(attest({ attestation: fixtureAttestation({ authData }) })).toThrow('nonce mismatch');
  });

  it('rejects a chain without its intermediate and a foreign format', () => {
    expect(attest({ attestation: fixtureAttestation({ x5c: [Buffer.from(new X509Certificate(fixture.credentialPem).raw)] }) })).toThrow(
      'missing certificate chain',
    );
    expect(attest({ attestation: fixtureAttestation({ fmt: 'packed' }) })).toThrow('unexpected attestation format');
    expect(attest({ attestation: Buffer.from('not cbor') })).toThrow('malformed CBOR');
  });

  it('rejects certificates outside their validity period', () => {
    expect(attest({}, { now: new Date('2000-01-01T00:00:00Z') })).toThrow('outside its validity period');
  });
});

describe('verifyAssertion', () => {
  const { publicKeyPem } = verifyAttestation(input, policy);
  const clientData = Buffer.from('bookorbit-app-attest-v1\nGET\n/api/v1/notebook/overview\n1\nabc');
  const assertion = (counter: number, options?: Parameters<typeof fixtureAssertion>[2]) => ({
    assertion: fixtureAssertion(clientData, counter, options),
    clientData,
    publicKeyPem,
    appId: fixture.appId,
    isFreshCounter: (counter: number) => counter > 0,
  });

  it('accepts a signature over the request with a fresh counter', () => {
    expect(verifyAssertion(assertion(1))).toEqual({ counter: 1 });
    expect(() => verifyAssertion(assertion(2, { digestIsNonce: true }))).toThrow('assertion signature is invalid');
  });

  it('rejects a used counter, other request bytes and another app', () => {
    expect(() => verifyAssertion({ ...assertion(3), isFreshCounter: () => false })).toThrow('counter was already used or is too old');
    expect(() => verifyAssertion({ ...assertion(4), clientData: Buffer.from('tampered') })).toThrow('signature is invalid');
    expect(() => verifyAssertion(assertion(5, { appId: 'OTHERTEAM1.app.bookorbit.test' }))).toThrow('assertion app id mismatch');
  });
});
