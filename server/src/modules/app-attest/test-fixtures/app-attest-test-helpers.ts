import { createHash, createPrivateKey, sign, X509Certificate } from 'node:crypto';

import { ATTESTATION_FIXTURE } from './attestation-fixture';

type Encodable = number | Buffer | string | Encodable[] | Map<Encodable, Encodable>;

export function encodeCbor(value: Encodable): Buffer {
  if (typeof value === 'number') return head(0, value);
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === 'string') return Buffer.concat([head(3, Buffer.byteLength(value)), Buffer.from(value)]);
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(encodeCbor)]);
  return Buffer.concat([head(5, value.size), ...[...value].flatMap(([key, item]) => [encodeCbor(key), encodeCbor(item)])]);
}

function head(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 0x100) return Buffer.from([(major << 5) | 24, length]);
  if (length < 0x10000) return Buffer.from([(major << 5) | 25, length >> 8, length & 0xff]);
  const bytes = Buffer.alloc(5);
  bytes[0] = (major << 5) | 26;
  bytes.writeUInt32BE(length, 1);
  return bytes;
}

const sha256 = (...parts: Buffer[]) => createHash('sha256').update(Buffer.concat(parts)).digest();
const der = (pem: string) => Buffer.from(new X509Certificate(pem).raw);

export function fixtureAttestation(overrides: { fmt?: string; authData?: Buffer; x5c?: Buffer[] } = {}): Buffer {
  const statement = new Map<Encodable, Encodable>([
    ['x5c', overrides.x5c ?? [der(ATTESTATION_FIXTURE.credentialPem), der(ATTESTATION_FIXTURE.intermediatePem)]],
    ['receipt', Buffer.from('receipt')],
  ]);
  return encodeCbor(
    new Map<Encodable, Encodable>([
      ['fmt', overrides.fmt ?? 'apple-appattest'],
      ['attStmt', statement],
      ['authData', overrides.authData ?? Buffer.from(ATTESTATION_FIXTURE.authDataHex, 'hex')],
    ]),
  );
}

/** Signs like the Secure Enclave: an ES256 signature over the nonce, so the digest is SHA256(nonce). */
export function fixtureAssertion(clientData: Buffer, counter: number, options: { appId?: string; digestIsNonce?: boolean } = {}): Buffer {
  const counterBytes = Buffer.alloc(4);
  counterBytes.writeUInt32BE(counter);
  const authData = Buffer.concat([sha256(Buffer.from(options.appId ?? ATTESTATION_FIXTURE.appId)), Buffer.from([0x40]), counterBytes]);
  const clientDataHash = sha256(clientData);
  const key = createPrivateKey(ATTESTATION_FIXTURE.credentialPrivateKeyPem);
  const message = options.digestIsNonce ? Buffer.concat([authData, clientDataHash]) : sha256(authData, clientDataHash);
  return encodeCbor(
    new Map<Encodable, Encodable>([
      ['signature', sign('sha256', message, key)],
      ['authenticatorData', authData],
    ]),
  );
}
