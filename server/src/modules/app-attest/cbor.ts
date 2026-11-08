/**
 * Decodes the CBOR subset App Attest uses: unsigned and negative integers, byte and text strings,
 * arrays and maps. Anything else (tags, floats, indefinite lengths) is refused, since a genuine
 * attestation or assertion never carries it.
 */
export type CborValue = number | Buffer | string | CborValue[] | Map<CborValue, CborValue>;

const MAX_DEPTH = 8;
const MAX_ITEMS = 64;

export function decodeCbor(input: Buffer): CborValue {
  const reader = { offset: 0 };
  const value = readItem(input, reader, 0);
  if (reader.offset !== input.length) throw new Error('trailing bytes after CBOR item');
  return value;
}

function readItem(input: Buffer, reader: { offset: number }, depth: number): CborValue {
  if (depth > MAX_DEPTH) throw new Error('CBOR nesting too deep');
  const initial = readBytes(input, reader, 1)[0];
  const major = initial >> 5;
  const length = readLength(input, reader, initial & 0x1f);
  switch (major) {
    case 0:
      return length;
    case 1:
      return -1 - length;
    case 2:
      return Buffer.from(readBytes(input, reader, length));
    case 3:
      return readBytes(input, reader, length).toString('utf8');
    case 4: {
      if (length > MAX_ITEMS) throw new Error('CBOR array too long');
      const items: CborValue[] = [];
      for (let i = 0; i < length; i++) items.push(readItem(input, reader, depth + 1));
      return items;
    }
    case 5: {
      if (length > MAX_ITEMS) throw new Error('CBOR map too long');
      const map = new Map<CborValue, CborValue>();
      for (let i = 0; i < length; i++) map.set(readItem(input, reader, depth + 1), readItem(input, reader, depth + 1));
      return map;
    }
    default:
      throw new Error(`unsupported CBOR major type ${major}`);
  }
}

function readLength(input: Buffer, reader: { offset: number }, info: number): number {
  if (info < 24) return info;
  if (info === 24) return readBytes(input, reader, 1).readUInt8(0);
  if (info === 25) return readBytes(input, reader, 2).readUInt16BE(0);
  if (info === 26) return readBytes(input, reader, 4).readUInt32BE(0);
  throw new Error('unsupported CBOR length encoding');
}

function readBytes(input: Buffer, reader: { offset: number }, count: number): Buffer {
  if (reader.offset + count > input.length) throw new Error('truncated CBOR input');
  const bytes = input.subarray(reader.offset, reader.offset + count);
  reader.offset += count;
  return bytes;
}
