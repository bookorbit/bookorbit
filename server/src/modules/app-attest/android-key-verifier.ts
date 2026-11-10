import { createHash, createPublicKey, verify, X509Certificate, type KeyObject } from 'node:crypto';

import {
  KEY_DESCRIPTION_OID,
  KEYMINT,
  parseKeyDescription,
  SECURITY_LEVEL,
  VERIFIED_BOOT_STATE,
  type AuthorizationList,
  type KeyDescription,
} from './android-key-description';
import { AppAttestVerificationError, type AttestedKey } from './app-attest-verifier';
import { certificateExtension, DerError } from './der';

export interface AndroidAppIdentity {
  packageName: string;
  /** SHA-256 of an allowed signing certificate, lowercase hex, or `any` for a development build. */
  signatureDigests: readonly string[] | 'any';
  development: boolean;
}

export interface AndroidAttestationPolicy {
  apps: readonly AndroidAppIdentity[];
  /** PEM certificates a hardware chain must end at. */
  trustedRoots: readonly string[];
  /**
   * Accepts a software keystore (an emulator's), a chain ending at any self-signed root, and any
   * verified boot state. Each is forgeable, so only a server outside production allows it.
   */
  allowDevelopment: boolean;
  now?: Date;
}

export interface AndroidAttestationInput {
  keyId: string;
  /** DER, leaf first. */
  chain: Buffer[];
  challenge: Buffer;
}

export interface AttestedAndroidKey extends AttestedKey {
  /** Serial numbers above the leaf, lowercase hex, for Google's revocation list; empty for a chain not anchored at Google. */
  revocableSerials: string[];
}

const MIN_CHAIN = 2;
const MAX_CHAIN = 10;

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest();

/**
 * Android Key Attestation, as Android's guide "Verify hardware-backed key pairs with key
 * attestation" describes it: a chain to Google's root, then the leaf's key description.
 */
export function verifyAndroidAttestation(input: AndroidAttestationInput, policy: AndroidAttestationPolicy): AttestedAndroidKey {
  if (input.chain.length < MIN_CHAIN || input.chain.length > MAX_CHAIN) throw new AppAttestVerificationError('unexpected chain length');
  const certificates = input.chain.map(parseCertificate);
  const now = policy.now ?? new Date();
  verifyLinks(certificates, now);
  const anchoredAtGoogle = isAnchored(certificates[certificates.length - 1], policy.trustedRoots, now);
  if (!anchoredAtGoogle && !(policy.allowDevelopment && isSelfSigned(certificates[certificates.length - 1]))) {
    throw new AppAttestVerificationError('certificate chain does not reach a trusted root');
  }

  const description = keyDescriptionOf(input.chain[0]);
  if (!description.challenge.equals(input.challenge)) throw new AppAttestVerificationError('challenge mismatch');

  const hardware =
    anchoredAtGoogle &&
    description.attestationSecurityLevel !== SECURITY_LEVEL.software &&
    description.keyMintSecurityLevel !== SECURITY_LEVEL.software;
  if (!hardware && !policy.allowDevelopment) throw new AppAttestVerificationError('key is not hardware backed');

  // A software keystore enforces nothing in hardware and lists everything as software enforced.
  const enforced = hardware ? description.hardwareEnforced : mergeLists(description.hardwareEnforced, description.softwareEnforced);
  checkKey(enforced);
  if (hardware) checkRootOfTrust(enforced, policy.allowDevelopment);

  const identity = matchApp(description, policy);
  const leaf = certificates[0];
  const keyIdBytes = sha256(uncompressedPoint(leaf.publicKey));
  if (!keyIdBytes.equals(Buffer.from(input.keyId, 'base64'))) throw new AppAttestVerificationError('key id does not match the attested key');

  const environment = hardware && !identity.development ? 'production' : 'development';
  if (environment === 'development' && !policy.allowDevelopment) throw new AppAttestVerificationError('development attestations are not accepted');

  return {
    keyId: keyIdBytes.toString('base64'),
    publicKeyPem: leaf.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    appId: identity.packageName,
    environment,
    revocableSerials: anchoredAtGoogle ? certificates.slice(1).map((certificate) => normalizeSerial(certificate.serialNumber)) : [],
  };
}

/** An ECDSA P-256 signature over SHA-256 of the client data itself, as `SHA256withECDSA` makes it. */
export function verifyAndroidAssertion(input: { signature: Buffer; clientData: Buffer; publicKeyPem: string }): void {
  if (!verify('sha256', input.clientData, createPublicKey(input.publicKeyPem), input.signature)) {
    throw new AppAttestVerificationError('assertion signature is invalid');
  }
}

/** How Google's revocation list writes a serial: lowercase hex without leading zeros. */
export function normalizeSerial(serial: string): string {
  return serial.toLowerCase().replace(/^0+(?=.)/, '');
}

/**
 * Every certificate signed by the next. Dates are checked above the leaf only: the keystore writes
 * its leaf's dates from fixed values (an emulator's run from 1970 to 2048), and the chain's own copy
 * of the root is not the trust anchor, since older devices carry an earlier, expired certificate of
 * Google's RSA root.
 */
function verifyLinks(certificates: X509Certificate[], now: Date): void {
  for (let index = 0; index < certificates.length - 1; index++) {
    const child = certificates[index];
    const parent = certificates[index + 1];
    if (!parent.ca) throw new AppAttestVerificationError('an issuer in the chain is not a CA');
    if (!child.checkIssued(parent) || !child.verify(parent.publicKey)) {
      throw new AppAttestVerificationError('a certificate is not signed by the next');
    }
    if (index + 1 < certificates.length - 1 && !isCurrent(parent, now)) {
      throw new AppAttestVerificationError('certificate is outside its validity period');
    }
  }
}

function isAnchored(last: X509Certificate, trustedRoots: readonly string[], now: Date): boolean {
  const lastKey = spki(last.publicKey);
  return trustedRoots.some((pem) => {
    const root = new X509Certificate(pem);
    if (!isCurrent(root, now)) return false;
    if (spki(root.publicKey).equals(lastKey)) return true;
    // A chain that stops below the root: its last certificate is an intermediate, dated like one.
    return last.checkIssued(root) && last.verify(root.publicKey) && isCurrent(last, now);
  });
}

function isSelfSigned(certificate: X509Certificate): boolean {
  return certificate.checkIssued(certificate) && certificate.verify(certificate.publicKey);
}

function keyDescriptionOf(leafDer: Buffer): KeyDescription {
  try {
    const extension = certificateExtension(leafDer, KEY_DESCRIPTION_OID);
    if (!extension) throw new AppAttestVerificationError('certificate has no key description');
    return parseKeyDescription(extension);
  } catch (error) {
    if (error instanceof DerError) throw new AppAttestVerificationError(`malformed key description: ${error.reason}`);
    throw error;
  }
}

function mergeLists(first: AuthorizationList, second: AuthorizationList): AuthorizationList {
  const merged: AuthorizationList = { ...second };
  for (const [name, value] of Object.entries(first) as [keyof AuthorizationList, never][]) {
    if (value !== undefined) merged[name] = value;
  }
  return merged;
}

function checkKey(enforced: AuthorizationList): void {
  if (enforced.algorithm !== KEYMINT.algorithmEc) throw new AppAttestVerificationError('attested key is not EC');
  if (enforced.ecCurve !== undefined && enforced.ecCurve !== KEYMINT.curveP256) throw new AppAttestVerificationError('attested key is not P-256');
  if (!enforced.purposes?.includes(KEYMINT.purposeSign)) throw new AppAttestVerificationError('attested key cannot sign');
  if (enforced.origin !== KEYMINT.originGenerated) throw new AppAttestVerificationError('attested key was not generated in the keystore');
}

/**
 * Verified boot is what makes the package name mean anything: on an unlocked phone the OS that
 * names the package to the keystore could name any. A locked phone on its owner's own signed OS
 * (GrapheneOS, CalyxOS) reports Self-signed and is accepted.
 */
function checkRootOfTrust(enforced: AuthorizationList, allowDevelopment: boolean): void {
  if (allowDevelopment) return;
  const root = enforced.rootOfTrust;
  if (!root) throw new AppAttestVerificationError('attestation has no root of trust');
  const locked =
    root.verifiedBootState === VERIFIED_BOOT_STATE.verified || (root.verifiedBootState === VERIFIED_BOOT_STATE.selfSigned && root.deviceLocked);
  if (!locked) throw new AppAttestVerificationError('device boot is not verified');
}

/** The package always comes from the software list: the keystore is told it by the OS. */
function matchApp(description: KeyDescription, policy: AndroidAttestationPolicy): AndroidAppIdentity {
  const application = description.softwareEnforced.applicationId ?? description.hardwareEnforced.applicationId;
  if (!application) throw new AppAttestVerificationError('attestation names no application');
  const identity = policy.apps.find(
    (app) =>
      application.packageNames.includes(app.packageName) &&
      (app.signatureDigests === 'any' || application.signatureDigests.some((digest) => app.signatureDigests.includes(digest))),
  );
  if (!identity) throw new AppAttestVerificationError('app id is not allowed');
  return identity;
}

function parseCertificate(der: Buffer): X509Certificate {
  try {
    return new X509Certificate(der);
  } catch {
    throw new AppAttestVerificationError('malformed certificate');
  }
}

function isCurrent(certificate: X509Certificate, now: Date): boolean {
  return new Date(certificate.validFrom) <= now && now <= new Date(certificate.validTo);
}

function spki(key: KeyObject): Buffer {
  return key.export({ type: 'spki', format: 'der' });
}

function uncompressedPoint(key: KeyObject): Buffer {
  const jwk = key.export({ format: 'jwk' });
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) throw new AppAttestVerificationError('attested key is not P-256');
  return Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
}
