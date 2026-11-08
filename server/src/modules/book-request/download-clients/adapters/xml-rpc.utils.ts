import { XMLParser } from 'fast-xml-parser';

/** What a call sends. rTorrent itself only ever needs strings and a .torrent as base64. */
export type XmlRpcParam = string | number | boolean | Buffer | XmlRpcParam[] | { [member: string]: XmlRpcParam };

/** What comes back. rTorrent answers in strings, `i8` and arrays; the rest is accepted for completeness. */
export type XmlRpcValue = string | number | boolean | Buffer | null | XmlRpcValue[] | XmlRpcStruct;
export interface XmlRpcStruct {
  [member: string]: XmlRpcValue;
}

/** The server answered, and its answer was a refusal. Carries the server's own reason. */
export class XmlRpcFault extends Error {
  constructor(
    readonly code: number | null,
    readonly reason: string,
  ) {
    super(reason);
    this.name = 'XmlRpcFault';
  }
}

/** Something answered, but not in XML-RPC: a login page, a proxy error, a plain-text refusal. */
export class XmlRpcMalformedError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'XmlRpcMalformedError';
  }
}

/**
 * `parseTagValue: false` keeps every scalar a string until its XML-RPC type decides, so a hash
 * made only of digits is never turned into a number. `trimValues: false` because a torrent name
 * may start or end with a space and the name is what reconciliation shows. `value`, `member` and
 * `param` are forced to arrays because the parser collapses a single occurrence to the element
 * itself, which would give a one-torrent listing a different shape from a two-torrent one.
 *
 * `htmlEntities` is what decodes numeric character references (`&#13;`); XML's five named
 * entities are decoded either way, and `&amp;` last, so nothing is decoded twice.
 */
const PARSER = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: false,
  processEntities: true,
  htmlEntities: true,
  isArray: (name) => name === 'value' || name === 'member' || name === 'param',
});

const DECLARATION = '<?xml version="1.0"?>';

/** XML 1.0 cannot carry these at all, escaped or not. */
const INVALID_XML_CHARACTER = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/u;

const INTEGER_TYPES = ['i8', 'ex:i8', 'i4', 'int'] as const;
const NIL_TYPES = ['nil', 'ex:nil'] as const;

export function encodeMethodCall(method: string, params: readonly XmlRpcParam[]): string {
  const encodedParams = params.map((param) => `<param><value>${encodeValue(param)}</value></param>`).join('');
  return `${DECLARATION}<methodCall><methodName>${escapeText(method)}</methodName><params>${encodedParams}</params></methodCall>`;
}

function encodeValue(value: XmlRpcParam): string {
  if (Buffer.isBuffer(value)) return `<base64>${value.toString('base64')}</base64>`;
  if (typeof value === 'string') return `<string>${escapeText(value)}</string>`;
  if (typeof value === 'boolean') return `<boolean>${value ? 1 : 0}</boolean>`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new XmlRpcMalformedError('XML-RPC cannot carry a number that is not finite');
    // i8 rather than int: a byte count outgrows 32 bits long before anything else here does.
    return Number.isInteger(value) ? `<i8>${value}</i8>` : `<double>${value}</double>`;
  }
  if (Array.isArray(value)) return `<array><data>${value.map((item) => `<value>${encodeValue(item)}</value>`).join('')}</data></array>`;
  const members = Object.entries(value)
    .map(([name, member]) => `<member><name>${escapeText(name)}</name><value>${encodeValue(member)}</value></member>`)
    .join('');
  return `<struct>${members}</struct>`;
}

function escapeText(text: string): string {
  if (INVALID_XML_CHARACTER.test(text)) throw new XmlRpcMalformedError('That text contains a character XML-RPC cannot carry');
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The single value a method returned. A fault is thrown as `XmlRpcFault`. */
export function decodeMethodResponse(xml: string): XmlRpcValue {
  // XML-RPC never declares a DTD. Refusing one outright is simpler than trusting every parser
  // option involved in entity expansion to stay closed.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new XmlRpcMalformedError('The answer declared a DTD, which XML-RPC never does');

  let document: unknown;
  try {
    document = PARSER.parse(xml);
  } catch {
    throw new XmlRpcMalformedError('The answer was not XML');
  }

  const response = asRecord(asRecord(document)?.methodResponse);
  if (!response) throw new XmlRpcMalformedError('The answer was not an XML-RPC response');

  if (response.fault !== undefined) throw faultFrom(firstValue(asRecord(response.fault)?.value));

  const params = asRecord(response.params);
  const param = Array.isArray(params?.param) ? asRecord(params.param[0]) : null;
  const value = firstValue(param?.value);
  if (value === undefined) throw new XmlRpcMalformedError('The XML-RPC response carried no value');
  return decodeValue(value);
}

/**
 * `system.multicall` answers each call in its own slot: a one-element array on success, a fault
 * struct on failure. A fault in one slot is that call's answer, not the whole request's.
 */
export function decodeMulticallResults(value: XmlRpcValue, expected: number): Array<XmlRpcValue | XmlRpcFault> {
  if (!Array.isArray(value) || value.length !== expected) {
    throw new XmlRpcMalformedError(`system.multicall answered ${Array.isArray(value) ? value.length : 'no'} results for ${expected} calls`);
  }
  return value.map((slot) => {
    if (Array.isArray(slot)) {
      if (slot.length !== 1) throw new XmlRpcMalformedError('system.multicall answered a slot that is neither a value nor a fault');
      return slot[0];
    }
    if (isStruct(slot) && ('faultString' in slot || 'faultCode' in slot)) return faultFromStruct(slot);
    throw new XmlRpcMalformedError('system.multicall answered a slot that is neither a value nor a fault');
  });
}

function decodeValue(node: unknown): XmlRpcValue {
  // A bare `<value>text</value>` is a string by definition.
  if (typeof node === 'string') return node;
  const value = asRecord(node);
  if (!value) return '';

  if (value.string !== undefined) return textOf(value.string);
  for (const type of INTEGER_TYPES) {
    if (value[type] !== undefined) return parseInteger(textOf(value[type]));
  }
  if (value.boolean !== undefined) return parseBoolean(textOf(value.boolean));
  if (value.double !== undefined) return parseDouble(textOf(value.double));
  if (value.array !== undefined) return decodeArray(value.array);
  if (value.struct !== undefined) return decodeStruct(value.struct);
  if (value.base64 !== undefined) return Buffer.from(textOf(value.base64).replace(/\s+/g, ''), 'base64');
  if (value['dateTime.iso8601'] !== undefined) return textOf(value['dateTime.iso8601']).trim();
  for (const type of NIL_TYPES) {
    if (value[type] !== undefined) return null;
  }

  // An untyped value with element children it does not recognise is not something to guess at.
  const typed = Object.keys(value).filter((key) => key !== '#text');
  if (typed.length > 0) throw new XmlRpcMalformedError(`Unsupported XML-RPC type <${typed[0]}>`);
  return textOf(value['#text']);
}

function decodeArray(node: unknown): XmlRpcValue[] {
  // `<data/>` and a pretty-printed `<data>\n</data>` both parse to a string, and both are empty.
  const data = asRecord(asRecord(node)?.data);
  const values = data?.value;
  return Array.isArray(values) ? values.map(decodeValue) : [];
}

function decodeStruct(node: unknown): XmlRpcStruct {
  const struct = asRecord(node);
  const members = Array.isArray(struct?.member) ? struct.member : [];
  const result: XmlRpcStruct = {};
  for (const entry of members) {
    const member = asRecord(entry);
    const name = member ? textOf(member.name) : '';
    if (!name) continue;
    const value = firstValue(member?.value);
    result[name] = value === undefined ? '' : decodeValue(value);
  }
  return result;
}

function faultFrom(node: unknown): XmlRpcFault {
  const decoded = node === undefined ? null : decodeValue(node);
  return isStruct(decoded) ? faultFromStruct(decoded) : new XmlRpcFault(null, 'no reason given');
}

function faultFromStruct(struct: XmlRpcStruct): XmlRpcFault {
  const code = typeof struct.faultCode === 'number' ? struct.faultCode : null;
  const reason = typeof struct.faultString === 'string' && struct.faultString.trim() ? struct.faultString.trim() : 'no reason given';
  return new XmlRpcFault(code, reason);
}

function parseInteger(text: string): number {
  const trimmed = text.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) throw new XmlRpcMalformedError(`"${trimmed.slice(0, 40)}" is not an XML-RPC integer`);
  return Number(trimmed);
}

function parseBoolean(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === '1' || trimmed === 'true') return true;
  if (trimmed === '0' || trimmed === 'false') return false;
  throw new XmlRpcMalformedError(`"${trimmed.slice(0, 40)}" is not an XML-RPC boolean`);
}

function parseDouble(text: string): number {
  const parsed = Number(text.trim());
  if (!Number.isFinite(parsed)) throw new XmlRpcMalformedError(`"${text.trim().slice(0, 40)}" is not an XML-RPC double`);
  return parsed;
}

function firstValue(values: unknown): unknown {
  return Array.isArray(values) ? values[0] : undefined;
}

/** `<string></string>` parses to '' and `<string>x</string>` to 'x'; anything else carries no text. */
function textOf(node: unknown): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  const record = asRecord(node);
  return typeof record?.['#text'] === 'string' ? record['#text'] : '';
}

function isStruct(value: unknown): value is XmlRpcStruct {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
