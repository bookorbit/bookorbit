export class DerError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'DerError';
  }
}

export const DER_CLASS = { universal: 0, context: 2 } as const;
export const DER_TAG = { boolean: 1, integer: 2, octetString: 4, oid: 6, enumerated: 10, sequence: 16, set: 17 } as const;

export interface DerElement {
  tagClass: number;
  constructed: boolean;
  tag: number;
  value: Buffer;
}

const MAX_TAG_BYTES = 4;
const MAX_LENGTH_BYTES = 4;

/** One element at `offset`, with multi-byte tag numbers (an Android key description runs past 700). */
export function readDerElement(buffer: Buffer, offset: number): { element: DerElement; end: number } {
  let cursor = offset;
  if (cursor >= buffer.length) throw new DerError('truncated DER');
  const first = buffer[cursor++];
  let tag = first & 0x1f;
  if (tag === 0x1f) {
    tag = 0;
    for (let count = 0; ; count++) {
      if (count === MAX_TAG_BYTES || cursor >= buffer.length) throw new DerError('unsupported DER tag');
      const byte = buffer[cursor++];
      tag = tag * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) break;
    }
  }
  if (cursor >= buffer.length) throw new DerError('truncated DER length');
  let length = buffer[cursor++];
  if (length === 0x80) throw new DerError('indefinite DER length');
  if (length & 0x80) {
    const lengthBytes = length & 0x7f;
    if (lengthBytes > MAX_LENGTH_BYTES || cursor + lengthBytes > buffer.length) throw new DerError('unsupported DER length');
    length = 0;
    for (let i = 0; i < lengthBytes; i++) length = length * 256 + buffer[cursor++];
  }
  if (cursor + length > buffer.length) throw new DerError('truncated DER value');
  return {
    element: { tagClass: first >> 6, constructed: (first & 0x20) !== 0, tag, value: buffer.subarray(cursor, cursor + length) },
    end: cursor + length,
  };
}

/** The single element `buffer` holds, refusing trailing bytes. */
export function readDer(buffer: Buffer): DerElement {
  const { element, end } = readDerElement(buffer, 0);
  if (end !== buffer.length) throw new DerError('trailing bytes after DER');
  return element;
}

export function derChildren(element: DerElement): DerElement[] {
  if (!element.constructed) throw new DerError('DER element is not constructed');
  const children: DerElement[] = [];
  for (let cursor = 0; cursor < element.value.length;) {
    const { element: child, end } = readDerElement(element.value, cursor);
    children.push(child);
    cursor = end;
  }
  return children;
}

export function isUniversal(element: DerElement, tag: number): boolean {
  return element.tagClass === DER_CLASS.universal && element.tag === tag;
}

export function expectUniversal(element: DerElement | undefined, tag: number, name: string): DerElement {
  if (!element || !isUniversal(element, tag)) throw new DerError(`${name} has the wrong DER type`);
  return element;
}

/** A non-negative INTEGER or ENUMERATED that fits a safe integer. */
export function derUnsigned(element: DerElement | undefined, name: string): number {
  if (!element || element.tagClass !== DER_CLASS.universal || (element.tag !== DER_TAG.integer && element.tag !== DER_TAG.enumerated)) {
    throw new DerError(`${name} is not an integer`);
  }
  const bytes = element.value;
  if (bytes.length === 0 || bytes[0] & 0x80) throw new DerError(`${name} is not a non-negative integer`);
  let value = 0;
  for (const byte of bytes) {
    value = value * 256 + byte;
    if (!Number.isSafeInteger(value)) throw new DerError(`${name} is too large`);
  }
  return value;
}

export function derBoolean(element: DerElement | undefined, name: string): boolean {
  const { value } = expectUniversal(element, DER_TAG.boolean, name);
  if (value.length !== 1) throw new DerError(`${name} is not a boolean`);
  return value[0] !== 0;
}

export function derOctets(element: DerElement | undefined, name: string): Buffer {
  return expectUniversal(element, DER_TAG.octetString, name).value;
}

export function derOid(element: DerElement | undefined, name: string): string {
  const { value } = expectUniversal(element, DER_TAG.oid, name);
  if (value.length === 0) throw new DerError(`${name} is an empty OID`);
  const arcs: number[] = [];
  let arc = 0;
  for (const byte of value) {
    arc = arc * 128 + (byte & 0x7f);
    if (!Number.isSafeInteger(arc)) throw new DerError(`${name} has an oversized arc`);
    if (!(byte & 0x80)) {
      arcs.push(arc);
      arc = 0;
    }
  }
  if (value[value.length - 1] & 0x80) throw new DerError(`${name} is truncated`);
  const first = arcs.shift()!;
  const head = first < 80 ? [Math.floor(first / 40), first % 40] : [2, first - 80];
  return [...head, ...arcs].join('.');
}

/** The value of a certificate's extension, or undefined when it has none by that OID. */
export function certificateExtension(certificateDer: Buffer, oid: string): Buffer | undefined {
  const certificate = derChildren(expectUniversal(readDer(certificateDer), DER_TAG.sequence, 'certificate'));
  const tbs = derChildren(expectUniversal(certificate[0], DER_TAG.sequence, 'tbsCertificate'));
  const wrapper = tbs.find((field) => field.tagClass === DER_CLASS.context && field.tag === 3);
  if (!wrapper) return undefined;
  const [extensions, extra] = derChildren(wrapper);
  if (extra) throw new DerError('extensions wrapper holds more than one element');
  let found: Buffer | undefined;
  for (const extension of derChildren(expectUniversal(extensions, DER_TAG.sequence, 'extensions'))) {
    const fields = derChildren(expectUniversal(extension, DER_TAG.sequence, 'extension'));
    if (derOid(fields[0], 'extension id') !== oid) continue;
    if (found) throw new DerError('extension appears twice');
    found = derOctets(fields[fields.length - 1], 'extension value');
  }
  return found;
}
