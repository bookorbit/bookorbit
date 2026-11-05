import { createHash, createPublicKey, verify, X509Certificate, type KeyObject } from 'node:crypto';

import { APPLE_APP_ATTESTATION_ROOT_CA } from './apple-app-attestation-root';
import { decodeCbor, type CborValue } from './cbor';

export type AppAttestEnvironment = 'production' | 'development';

export class AppAttestVerificationError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'AppAttestVerificationError';
  }
}

export interface AttestationInput {
  keyId: string;
  attestation: Buffer;
  challenge: Buffer;
}

export interface AttestationPolicy {
  appIds: readonly string[];
  allowDevelopment: boolean;
  trustedRoots?: readonly string[];
  now?: Date;
}

export interface AttestedKey {
  keyId: string;
  publicKeyPem: string;
  appId: string;
  environment: AppAttestEnvironment;
}

export interface AssertionInput {
  assertion: Buffer;
  clientData: Buffer;
  publicKeyPem: string;
  appId: string;
  isFreshCounter: (counter: number) => boolean;
}

// 1.2.840.113635.100.8.2, the credential certificate extension that carries the attestation nonce.
const NONCE_EXTENSION_OID = Buffer.from('06092a864886f763640802', 'hex');
const PRODUCTION_AAGUID = Buffer.concat([Buffer.from('appattest'), Buffer.alloc(7)]);
const DEVELOPMENT_AAGUID = Buffer.from('appattestdevelop');

const sha256 = (...parts: Buffer[]) => createHash('sha256').update(Buffer.concat(parts)).digest();

/** Apple's server-side attestation checks, in the order "Validating apps that connect to your server" lists them. */
export function verifyAttestation(input: AttestationInput, policy: AttestationPolicy): AttestedKey {
  const object = asMap(safeDecode(input.attestation), 'attestation');
  if (object.get('fmt') !== 'apple-appattest') throw new AppAttestVerificationError('unexpected attestation format');
  const statement = asMap(object.get('attStmt'), 'attStmt');
  const authData = asBuffer(object.get('authData'), 'authData');
  const x5c = statement.get('x5c');
  if (!Array.isArray(x5c) || x5c.length < 2) throw new AppAttestVerificationError('missing certificate chain');

  const [credential, intermediate] = x5c.slice(0, 2).map((der) => parseCertificate(asBuffer(der, 'x5c')));
  verifyChain(credential, intermediate, policy.trustedRoots ?? [APPLE_APP_ATTESTATION_ROOT_CA], policy.now ?? new Date());

  const nonce = sha256(authData, sha256(input.challenge));
  if (!extractNonce(credential.raw).equals(nonce)) throw new AppAttestVerificationError('nonce mismatch');

  const publicKey = credential.publicKey;
  const keyIdBytes = sha256(uncompressedPoint(publicKey));
  if (!keyIdBytes.equals(Buffer.from(input.keyId, 'base64'))) throw new AppAttestVerificationError('key id does not match the attested key');

  const parsed = parseAuthData(authData, true);
  const appId = policy.appIds.find((candidate) => sha256(Buffer.from(candidate)).equals(parsed.rpIdHash));
  if (!appId) throw new AppAttestVerificationError('app id is not allowed');
  if (parsed.counter !== 0) throw new AppAttestVerificationError('attestation counter is not zero');

  const environment = parsed.aaguid.equals(PRODUCTION_AAGUID) ? 'production' : parsed.aaguid.equals(DEVELOPMENT_AAGUID) ? 'development' : null;
  if (!environment) throw new AppAttestVerificationError('unknown attestation environment');
  if (environment === 'development' && !policy.allowDevelopment) throw new AppAttestVerificationError('development attestations are not accepted');
  if (!parsed.credentialId.equals(keyIdBytes)) throw new AppAttestVerificationError('credential id does not match the key id');

  return {
    keyId: keyIdBytes.toString('base64'),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    appId,
    environment,
  };
}

/** Returns the assertion's counter, which the caller records so it cannot be used twice. */
export function verifyAssertion(input: AssertionInput): { counter: number } {
  const object = asMap(safeDecode(input.assertion), 'assertion');
  const signature = asBuffer(object.get('signature'), 'signature');
  const authData = asBuffer(object.get('authenticatorData'), 'authenticatorData');
  const parsed = parseAuthData(authData, false);
  if (!parsed.rpIdHash.equals(sha256(Buffer.from(input.appId)))) throw new AppAttestVerificationError('assertion app id mismatch');
  if (!input.isFreshCounter(parsed.counter)) throw new AppAttestVerificationError('assertion counter was already used or is too old');

  const clientDataHash = sha256(input.clientData);
  const nonce = sha256(authData, clientDataHash);
  // ES256 over the nonce, so the signed digest is SHA256(nonce). Confirmed on a real iPhone; the
  // other reading of Apple's "valid for nonce" (the nonce as the digest) does not verify.
  if (!verify('sha256', nonce, createPublicKey(input.publicKeyPem), signature))
    throw new AppAttestVerificationError('assertion signature is invalid');
  return { counter: parsed.counter };
}

function verifyChain(credential: X509Certificate, intermediate: X509Certificate, trustedRoots: readonly string[], now: Date): void {
  for (const certificate of [credential, intermediate]) assertCurrent(certificate, now);
  if (!intermediate.ca) throw new AppAttestVerificationError('intermediate is not a CA');
  if (!credential.checkIssued(intermediate) || !credential.verify(intermediate.publicKey)) {
    throw new AppAttestVerificationError('credential certificate is not signed by the intermediate');
  }
  const anchored = trustedRoots.some((pem) => {
    const root = new X509Certificate(pem);
    return isCurrent(root, now) && intermediate.checkIssued(root) && intermediate.verify(root.publicKey);
  });
  if (!anchored) throw new AppAttestVerificationError('certificate chain does not reach a trusted root');
}

function assertCurrent(certificate: X509Certificate, now: Date): void {
  if (!isCurrent(certificate, now)) throw new AppAttestVerificationError('certificate is outside its validity period');
}

function isCurrent(certificate: X509Certificate, now: Date): boolean {
  return new Date(certificate.validFrom) <= now && now <= new Date(certificate.validTo);
}

function parseCertificate(der: Buffer): X509Certificate {
  try {
    return new X509Certificate(der);
  } catch {
    throw new AppAttestVerificationError('malformed certificate');
  }
}

function uncompressedPoint(key: KeyObject): Buffer {
  const jwk = key.export({ format: 'jwk' });
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) throw new AppAttestVerificationError('attested key is not P-256');
  return Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
}

function parseAuthData(authData: Buffer, attested: boolean) {
  if (authData.length < 37) throw new AppAttestVerificationError('authenticator data is too short');
  const rpIdHash = authData.subarray(0, 32);
  const counter = authData.readUInt32BE(33);
  if (!attested) return { rpIdHash, counter, aaguid: Buffer.alloc(0), credentialId: Buffer.alloc(0) };
  if (authData.length < 55) throw new AppAttestVerificationError('authenticator data has no attested credential');
  const aaguid = authData.subarray(37, 53);
  const credentialIdLength = authData.readUInt16BE(53);
  if (authData.length < 55 + credentialIdLength) throw new AppAttestVerificationError('credential id is truncated');
  return { rpIdHash, counter, aaguid, credentialId: authData.subarray(55, 55 + credentialIdLength) };
}

/** Reads the nonce from `SEQUENCE { [1] EXPLICIT OCTET STRING }` inside the extension's value. */
function extractNonce(certificateDer: Buffer): Buffer {
  const at = certificateDer.indexOf(NONCE_EXTENSION_OID);
  if (at < 0) throw new AppAttestVerificationError('credential certificate has no nonce');
  let field = readTlv(certificateDer, at + NONCE_EXTENSION_OID.length);
  if (field.tag === 0x01) field = readTlv(certificateDer, field.end);
  if (field.tag !== 0x04) throw new AppAttestVerificationError('malformed nonce extension');
  const sequence = readTlv(field.value, 0);
  const tagged = sequence.tag === 0x30 ? readTlv(sequence.value, 0) : null;
  const octets = tagged?.tag === 0xa1 ? readTlv(tagged.value, 0) : null;
  if (!octets || octets.tag !== 0x04) throw new AppAttestVerificationError('malformed nonce extension');
  return octets.value;
}

function readTlv(buffer: Buffer, offset: number): { tag: number; value: Buffer; end: number } {
  if (offset + 2 > buffer.length) throw new AppAttestVerificationError('truncated DER');
  const tag = buffer[offset];
  let length = buffer[offset + 1];
  let cursor = offset + 2;
  if (length & 0x80) {
    const lengthBytes = length & 0x7f;
    if (lengthBytes < 1 || lengthBytes > 2 || cursor + lengthBytes > buffer.length) throw new AppAttestVerificationError('unsupported DER length');
    length = 0;
    for (let i = 0; i < lengthBytes; i++) length = length * 256 + buffer[cursor++];
  }
  if (cursor + length > buffer.length) throw new AppAttestVerificationError('truncated DER');
  return { tag, value: buffer.subarray(cursor, cursor + length), end: cursor + length };
}

function safeDecode(input: Buffer): CborValue {
  try {
    return decodeCbor(input);
  } catch {
    throw new AppAttestVerificationError('malformed CBOR');
  }
}

function asMap(value: CborValue | undefined, name: string): Map<CborValue, CborValue> {
  if (!(value instanceof Map)) throw new AppAttestVerificationError(`${name} is not a map`);
  return value;
}

function asBuffer(value: CborValue | undefined, name: string): Buffer {
  if (!Buffer.isBuffer(value)) throw new AppAttestVerificationError(`${name} is not a byte string`);
  return value;
}
