import { createHash, generateKeyPairSync, sign, X509Certificate, type KeyObject } from 'node:crypto';

/** DER, built by hand so a test can make the exact chain and key description it needs. */
function length(size: number): Buffer {
  if (size < 0x80) return Buffer.from([size]);
  const bytes: number[] = [];
  for (let rest = size; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

const tlv = (tag: number | Buffer, content: Buffer) =>
  Buffer.concat([typeof tag === 'number' ? Buffer.from([tag]) : tag, length(content.length), content]);
export const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
export const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));
export const octets = (value: Buffer) => tlv(0x04, value);
export const bool = (value: boolean) => tlv(0x01, Buffer.from([value ? 0xff : 0]));

function unsigned(tag: number, value: number): Buffer {
  const bytes: number[] = [];
  for (let rest = value; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  if (bytes.length === 0 || bytes[0] & 0x80) bytes.unshift(0);
  return tlv(tag, Buffer.from(bytes));
}
export const int = (value: number) => unsigned(0x02, value);
export const enumerated = (value: number) => unsigned(0x0a, value);

export function oid(dotted: string): Buffer {
  const [first, second, ...rest] = dotted.split('.').map(Number);
  const arcs = [first * 40 + second, ...rest];
  const bytes = arcs.flatMap((arc) => {
    const out = [arc & 0x7f];
    for (let value = Math.floor(arc / 128); value > 0; value = Math.floor(value / 128)) out.unshift(0x80 | (value & 0x7f));
    return out;
  });
  return tlv(0x06, Buffer.from(bytes));
}

/** `[tag] EXPLICIT`, with the multi-byte tag form past 30. */
export function explicit(tag: number, inner: Buffer): Buffer {
  if (tag < 31) return tlv(0xa0 | tag, inner);
  const number = [tag & 0x7f];
  for (let value = Math.floor(tag / 128); value > 0; value = Math.floor(value / 128)) number.unshift(0x80 | (value & 0x7f));
  return tlv(Buffer.from([0xbf, ...number]), inner);
}

const name = (commonName: string) => seq(set(seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(commonName)))));

function time(date: Date): Buffer {
  const iso = date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return date.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`)) : tlv(0x18, Buffer.from(`${iso}Z`));
}

const ECDSA_WITH_SHA256 = '1.2.840.10045.4.3.2';
const KEY_DESCRIPTION_OID = '1.3.6.1.4.1.11129.2.1.17';

interface CertificateSpec {
  serial: number;
  subject: string;
  issuer: string;
  publicKey: KeyObject;
  signingKey: KeyObject;
  ca?: boolean;
  notBefore?: Date;
  notAfter?: Date;
  keyDescription?: Buffer;
}

function certificate(spec: CertificateSpec): Buffer {
  const extensions: Buffer[] = [];
  if (spec.ca) extensions.push(seq(oid('2.5.29.19'), bool(true), octets(seq(bool(true)))));
  if (spec.keyDescription) extensions.push(seq(oid(KEY_DESCRIPTION_OID), octets(spec.keyDescription)));
  const tbs = seq(
    explicit(0, int(2)),
    int(spec.serial),
    seq(oid(ECDSA_WITH_SHA256)),
    name(spec.issuer),
    seq(time(spec.notBefore ?? new Date('2020-01-01T00:00:00Z')), time(spec.notAfter ?? new Date('2040-01-01T00:00:00Z'))),
    name(spec.subject),
    spec.publicKey.export({ type: 'spki', format: 'der' }),
    ...(extensions.length > 0 ? [explicit(3, seq(...extensions))] : []),
  );
  const signature = sign('sha256', tbs, spec.signingKey);
  return seq(tbs, seq(oid(ECDSA_WITH_SHA256)), tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
}

export interface KeyDescriptionSpec {
  challenge: Buffer;
  securityLevel?: number;
  packageName?: string;
  signatureDigest?: Buffer;
  verifiedBootState?: number;
  deviceLocked?: boolean;
  origin?: number;
  purposes?: number[];
  algorithm?: number;
  ecCurve?: number;
  withoutApplicationId?: boolean;
  /** As a software keystore writes it: every tag in the software list. */
  softwareOnly?: boolean;
}

export const FIXTURE_PACKAGE = 'app.bookorbit.reader';
export const FIXTURE_SIGNATURE_DIGEST = createHash('sha256').update('the release signing certificate').digest();

export function keyDescription(spec: KeyDescriptionSpec): Buffer {
  const level = spec.securityLevel ?? 1;
  const keyTags = [
    explicit(1, set(...(spec.purposes ?? [2]).map(int))),
    explicit(2, int(spec.algorithm ?? 3)),
    explicit(3, int(256)),
    explicit(10, int(spec.ecCurve ?? 1)),
    explicit(702, int(spec.origin ?? 0)),
    explicit(704, seq(octets(Buffer.alloc(32)), bool(spec.deviceLocked ?? true), enumerated(spec.verifiedBootState ?? 0), octets(Buffer.alloc(32)))),
  ];
  const applicationId = spec.withoutApplicationId
    ? []
    : [
        explicit(
          709,
          octets(
            seq(
              set(seq(octets(Buffer.from(spec.packageName ?? FIXTURE_PACKAGE)), int(1))),
              set(octets(spec.signatureDigest ?? FIXTURE_SIGNATURE_DIGEST)),
            ),
          ),
        ),
      ];
  const software = spec.softwareOnly ? seq(...keyTags, ...applicationId) : seq(...applicationId);
  const hardware = spec.softwareOnly ? seq() : seq(...keyTags);
  return seq(int(400), enumerated(level), int(400), enumerated(level), octets(spec.challenge), octets(Buffer.alloc(0)), software, hardware);
}

const p256 = () => generateKeyPairSync('ec', { namedCurve: 'P-256' });

export interface AndroidChainSpec extends Partial<KeyDescriptionSpec> {
  intermediateNotAfter?: Date;
  includeRoot?: boolean;
  /** Signs the leaf with a key that is not the intermediate's. */
  brokenLink?: boolean;
}

export interface AndroidChain {
  chain: Buffer[];
  rootPem: string;
  leafKey: KeyObject;
  keyId: string;
  challenge: string;
  serials: string[];
}

export function androidChain(spec: AndroidChainSpec = {}): AndroidChain {
  const challenge = spec.challenge?.toString() ?? 'challenge-for-the-fixture';
  const root = p256();
  const intermediate = p256();
  const leaf = p256();
  const rootDer = certificate({
    serial: 0x1001,
    subject: 'Fixture Root',
    issuer: 'Fixture Root',
    publicKey: root.publicKey,
    signingKey: root.privateKey,
    ca: true,
  });
  const intermediateDer = certificate({
    serial: 0x2002,
    subject: 'Fixture Intermediate',
    issuer: 'Fixture Root',
    publicKey: intermediate.publicKey,
    signingKey: root.privateKey,
    ca: true,
    notAfter: spec.intermediateNotAfter,
  });
  const leafDer = certificate({
    serial: 1,
    subject: 'Android Keystore Key',
    issuer: 'Fixture Intermediate',
    publicKey: leaf.publicKey,
    signingKey: spec.brokenLink ? p256().privateKey : intermediate.privateKey,
    notBefore: new Date('1970-01-01T00:00:00Z'),
    notAfter: new Date('2048-01-01T00:00:00Z'),
    keyDescription: keyDescription({ ...spec, challenge: Buffer.from(challenge) }),
  });
  const jwk = leaf.publicKey.export({ format: 'jwk' });
  const point = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]);
  return {
    chain: spec.includeRoot === false ? [leafDer, intermediateDer] : [leafDer, intermediateDer, rootDer],
    rootPem: new X509Certificate(rootDer).toString(),
    leafKey: leaf.privateKey,
    keyId: createHash('sha256').update(point).digest('base64'),
    challenge,
    serials: ['2002', '1001'],
  };
}

/** Signs as the Android app does: `SHA256withECDSA` over the client data. */
export function androidAssertion(clientData: Buffer, key: KeyObject): Buffer {
  return sign('sha256', clientData, key);
}
