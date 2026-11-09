import { DER_CLASS, DER_TAG, DerError, derBoolean, derChildren, derOctets, derUnsigned, expectUniversal, readDer, type DerElement } from './der';

/** The extension Android's keystore writes into an attested key's certificate. */
export const KEY_DESCRIPTION_OID = '1.3.6.1.4.1.11129.2.1.17';

export const SECURITY_LEVEL = { software: 0, trustedEnvironment: 1, strongBox: 2 } as const;
export const VERIFIED_BOOT_STATE = { verified: 0, selfSigned: 1, unverified: 2, failed: 3 } as const;
export const KEYMINT = { purposeSign: 2, algorithmEc: 3, curveP256: 1, originGenerated: 0 } as const;

export interface RootOfTrust {
  deviceLocked: boolean;
  verifiedBootState: number;
}

export interface AttestationApplicationId {
  packageNames: string[];
  /** SHA-256 of each signing certificate, lowercase hex. */
  signatureDigests: string[];
}

export interface AuthorizationList {
  purposes?: number[];
  algorithm?: number;
  keySize?: number;
  ecCurve?: number;
  origin?: number;
  rootOfTrust?: RootOfTrust;
  applicationId?: AttestationApplicationId;
}

export interface KeyDescription {
  attestationVersion: number;
  attestationSecurityLevel: number;
  keyMintVersion: number;
  keyMintSecurityLevel: number;
  challenge: Buffer;
  softwareEnforced: AuthorizationList;
  hardwareEnforced: AuthorizationList;
}

const TAG = { purpose: 1, algorithm: 2, keySize: 3, ecCurve: 10, origin: 702, rootOfTrust: 704, applicationId: 709 } as const;

/** Reads the `KeyDescription` schema of Android's key attestation guide; unknown tags are skipped. */
export function parseKeyDescription(extensionValue: Buffer): KeyDescription {
  const fields = derChildren(expectUniversal(readDer(extensionValue), DER_TAG.sequence, 'key description'));
  if (fields.length < 8) throw new DerError('key description is incomplete');
  return {
    attestationVersion: derUnsigned(fields[0], 'attestationVersion'),
    attestationSecurityLevel: derUnsigned(fields[1], 'attestationSecurityLevel'),
    keyMintVersion: derUnsigned(fields[2], 'keyMintVersion'),
    keyMintSecurityLevel: derUnsigned(fields[3], 'keyMintSecurityLevel'),
    challenge: derOctets(fields[4], 'attestationChallenge'),
    softwareEnforced: parseAuthorizationList(fields[6], 'softwareEnforced'),
    hardwareEnforced: parseAuthorizationList(fields[7], 'hardwareEnforced'),
  };
}

function parseAuthorizationList(element: DerElement | undefined, name: string): AuthorizationList {
  const list: AuthorizationList = {};
  const seen = new Set<number>();
  for (const entry of derChildren(expectUniversal(element, DER_TAG.sequence, name))) {
    if (entry.tagClass !== DER_CLASS.context || !entry.constructed) throw new DerError(`${name} has an untagged entry`);
    if (seen.has(entry.tag)) throw new DerError(`${name} repeats tag ${entry.tag}`);
    seen.add(entry.tag);
    const [inner, extra] = derChildren(entry);
    if (!inner || extra) throw new DerError(`${name} tag ${entry.tag} is not explicitly tagged`);
    switch (entry.tag) {
      case TAG.purpose:
        list.purposes = derChildren(expectUniversal(inner, DER_TAG.set, 'purpose')).map((purpose) => derUnsigned(purpose, 'purpose'));
        break;
      case TAG.algorithm:
        list.algorithm = derUnsigned(inner, 'algorithm');
        break;
      case TAG.keySize:
        list.keySize = derUnsigned(inner, 'keySize');
        break;
      case TAG.ecCurve:
        list.ecCurve = derUnsigned(inner, 'ecCurve');
        break;
      case TAG.origin:
        list.origin = derUnsigned(inner, 'origin');
        break;
      case TAG.rootOfTrust:
        list.rootOfTrust = parseRootOfTrust(inner);
        break;
      case TAG.applicationId:
        list.applicationId = parseApplicationId(derOctets(inner, 'attestationApplicationId'));
        break;
    }
  }
  return list;
}

function parseRootOfTrust(element: DerElement): RootOfTrust {
  const fields = derChildren(expectUniversal(element, DER_TAG.sequence, 'rootOfTrust'));
  derOctets(fields[0], 'verifiedBootKey');
  return { deviceLocked: derBoolean(fields[1], 'deviceLocked'), verifiedBootState: derUnsigned(fields[2], 'verifiedBootState') };
}

function parseApplicationId(bytes: Buffer): AttestationApplicationId {
  const [packages, digests] = derChildren(expectUniversal(readDer(bytes), DER_TAG.sequence, 'attestationApplicationId'));
  const packageNames = derChildren(expectUniversal(packages, DER_TAG.set, 'packageInfos')).map((info) => {
    const [name, version] = derChildren(expectUniversal(info, DER_TAG.sequence, 'packageInfo'));
    // The version code can pass a safe integer and nothing here reads it.
    expectUniversal(version, DER_TAG.integer, 'packageVersion');
    return derOctets(name, 'packageName').toString('utf8');
  });
  const signatureDigests = derChildren(expectUniversal(digests, DER_TAG.set, 'signatureDigests')).map((digest) =>
    derOctets(digest, 'signatureDigest').toString('hex'),
  );
  return { packageNames, signatureDigests };
}
