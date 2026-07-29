import iconv from 'iconv-lite';

/**
 * FB2 files are plain XML whose bytes may be in any encoding the declaration
 * names. Single-byte encodings keep ASCII markup at ASCII byte values, so tag
 * offsets can be found without decoding the whole document. UTF-16/UTF-32 do
 * not, which is why they are rejected for byte-level editing.
 */
export type Fb2Encoding = {
  /** Encoding label accepted by iconv-lite. */
  name: string;
  /** Label as it appeared in the XML declaration, when present. */
  declared: string | null;
  /** True when ASCII markup is byte-aligned, so byte offsets can be trusted. */
  byteAligned: boolean;
  bomLength: number;
};

const XML_DECL_ENCODING_RE = /<\?xml[^>]*?encoding\s*=\s*["']([^"']+)["'][^>]*\?>/i;
const DECLARATION_SCAN_BYTES = 512;

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16BE_BOM = Buffer.from([0xfe, 0xff]);

function normalizeLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

function isUtf16Or32(label: string): boolean {
  return /^(utf-?16|utf-?32|ucs-?2|ucs-?4|unicodefffe|unicode)/.test(label.replace(/-/g, ''));
}

/**
 * Inspects the leading bytes of an FB2 file and resolves the encoding to use
 * for its metadata block. Never decodes the whole buffer.
 */
export function detectFb2Encoding(head: Buffer): Fb2Encoding {
  if (head.subarray(0, 2).equals(UTF16LE_BOM)) {
    return { name: 'utf-16le', declared: null, byteAligned: false, bomLength: 2 };
  }
  if (head.subarray(0, 2).equals(UTF16BE_BOM)) {
    return { name: 'utf-16be', declared: null, byteAligned: false, bomLength: 2 };
  }

  const bomLength = head.subarray(0, 3).equals(UTF8_BOM) ? 3 : 0;
  const declaration = head.subarray(bomLength, bomLength + DECLARATION_SCAN_BYTES).toString('latin1');
  const declared = declaration.match(XML_DECL_ENCODING_RE)?.[1] ?? null;
  if (!declared) {
    return { name: 'utf-8', declared: null, byteAligned: true, bomLength };
  }

  const name = normalizeLabel(declared);
  if (isUtf16Or32(name)) {
    return { name, declared, byteAligned: false, bomLength };
  }

  return { name, declared, byteAligned: true, bomLength };
}

export function isFb2EncodingSupported(encoding: Fb2Encoding): boolean {
  return encoding.byteAligned && iconv.encodingExists(encoding.name);
}

export function decodeFb2(bytes: Buffer, encoding: Fb2Encoding): string {
  return iconv.decode(bytes, encoding.name);
}

export function encodeFb2(text: string, encoding: Fb2Encoding): Buffer {
  return iconv.encode(text, encoding.name);
}

/**
 * Decodes a whole FB2 buffer for reading. Falls back to UTF-8 when the declared
 * encoding is unknown to iconv-lite so extraction still yields ASCII metadata.
 */
export function decodeFb2Document(buffer: Buffer): { text: string; encoding: Fb2Encoding } {
  const encoding = detectFb2Encoding(buffer.subarray(0, DECLARATION_SCAN_BYTES + 3));
  if (!iconv.encodingExists(encoding.name)) {
    return { text: buffer.toString('utf8'), encoding: { ...encoding, name: 'utf-8' } };
  }
  return { text: decodeFb2(buffer, encoding), encoding };
}
