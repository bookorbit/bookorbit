// EXTH payloads and the record-0 full name use the encoding declared in the MOBI
// header (offset 28). Real libraries contain both UTF-8 (65001) and Windows-1252
// (1252) files; writing UTF-8 bytes into a cp1252 file renders as mojibake on device.

export const MOBI_ENCODING_UTF8 = 65001;
export const MOBI_ENCODING_CP1252 = 1252;

// cp1252 matches latin1 except for 0x80-0x9F, which carries these characters.
const CP1252_HIGH_RANGE: ReadonlyMap<number, number> = new Map([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);

const SUBSTITUTE_BYTE = 0x3f;

export interface MobiEncodeResult {
  buffer: Buffer;
  lossyChars: number;
}

export function encodeMobiText(value: string, encoding: number): MobiEncodeResult {
  if (encoding !== MOBI_ENCODING_CP1252) {
    return { buffer: Buffer.from(value, 'utf8'), lossyChars: 0 };
  }

  const bytes: number[] = [];
  let lossyChars = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0)!;
    if (codePoint < 0x80 || (codePoint >= 0xa0 && codePoint <= 0xff)) {
      bytes.push(codePoint);
      continue;
    }
    const mapped = CP1252_HIGH_RANGE.get(codePoint);
    if (mapped !== undefined) {
      bytes.push(mapped);
      continue;
    }
    bytes.push(SUBSTITUTE_BYTE);
    lossyChars++;
  }

  return { buffer: Buffer.from(bytes), lossyChars };
}

export function decodeMobiText(buffer: Buffer, encoding: number): string {
  return encoding === MOBI_ENCODING_CP1252 ? decodeCp1252(buffer) : buffer.toString('utf8');
}

function decodeCp1252(buffer: Buffer): string {
  const reverse = new Map([...CP1252_HIGH_RANGE].map(([codePoint, byte]) => [byte, codePoint]));
  let out = '';
  for (const byte of buffer) {
    out += String.fromCodePoint(reverse.get(byte) ?? byte);
  }
  return out;
}
