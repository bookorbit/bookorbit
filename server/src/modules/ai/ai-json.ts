import type { JsonSchema } from './ai-client.types';

export type AiJsonExtraction = { ok: true; value: unknown } | { ok: false; error: string };

const MAX_VALIDATION_ERRORS = 5;

/**
 * The JSON in a reply: the whole text when it parses, else the first complete JSON object in it.
 * Code fences and chatter around the object ("Here is the JSON: ...") are ignored.
 */
export function extractJson(text: string): AiJsonExtraction {
  const trimmed = stripFence(text.trim());
  if (!trimmed) return { ok: false, error: 'The reply was empty' };
  const whole = tryParse(trimmed);
  if (whole.ok) return whole;

  for (let start = trimmed.indexOf('{'); start !== -1; start = trimmed.indexOf('{', start + 1)) {
    const end = matchingBrace(trimmed, start);
    if (end === -1) break;
    const candidate = tryParse(trimmed.slice(start, end + 1));
    if (candidate.ok) return candidate;
  }
  return { ok: false, error: 'The reply did not contain a JSON object' };
}

/**
 * Checks a value against the subset of JSON Schema features ask for: `type` (one or several),
 * `enum`, `const`, `properties`, `required`, `additionalProperties`, `items`, `minItems`,
 * `maxItems`, `minLength`, `maxLength`, `minimum`, `maximum`, `anyOf` and `oneOf`. Returns the
 * first few problems with their paths, or null when the value fits.
 */
export function validateJson(value: unknown, schema: JsonSchema): string | null {
  const errors: string[] = [];
  check(value, schema, '$', errors);
  return errors.length === 0 ? null : errors.slice(0, MAX_VALIDATION_ERRORS).join('; ');
}

/** The follow-up message for the one retry after an invalid reply. */
export function repairMessage(problem: string): string {
  return `Your reply was not valid: ${problem}. Reply again with only the corrected JSON object, matching the schema exactly.`;
}

function stripFence(text: string): string {
  const fenced = /^```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?```$/.exec(text);
  return fenced ? fenced[1].trim() : text;
}

function tryParse(text: string): AiJsonExtraction {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid JSON' };
  }
}

/** The index of the brace closing the object that opens at `start`, skipping strings; -1 if none. */
function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return index;
  }
  return -1;
}

function check(value: unknown, schema: unknown, path: string, errors: string[]): void {
  if (errors.length >= MAX_VALIDATION_ERRORS || !isRecord(schema)) return;

  const alternatives = (Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : null) as unknown[] | null;
  if (alternatives) {
    if (!alternatives.some((alternative) => validateJson(value, alternative as JsonSchema) === null)) {
      errors.push(`${path} matches none of the allowed shapes`);
    }
    return;
  }

  if ('const' in schema && !sameJson(value, schema.const)) {
    errors.push(`${path} must be ${JSON.stringify(schema.const)}`);
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => sameJson(value, option))) {
    errors.push(`${path} must be one of ${schema.enum.map((option) => JSON.stringify(option)).join(', ')}`);
    return;
  }

  const types = typeof schema.type === 'string' ? [schema.type] : Array.isArray(schema.type) ? (schema.type as string[]) : null;
  if (types && !types.some((type) => isType(value, type))) {
    errors.push(`${path} must be ${types.join(' or ')}, not ${describe(value)}`);
    return;
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength)
      errors.push(`${path} is shorter than ${schema.minLength} characters`);
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) errors.push(`${path} is longer than ${schema.maxLength} characters`);
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path} is below ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${path} is above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) errors.push(`${path} has fewer than ${schema.minItems} items`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) errors.push(`${path} has more than ${schema.maxItems} items`);
    if (isRecord(schema.items)) value.forEach((item, index) => check(item, schema.items, `${path}[${index}]`, errors));
  }
  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const name of Array.isArray(schema.required) ? (schema.required as string[]) : []) {
      if (!(name in value)) errors.push(`${path}.${name} is missing`);
    }
    for (const [name, child] of Object.entries(value)) {
      if (name in properties) check(child, properties[name], `${path}.${name}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}.${name} is not allowed`);
      else if (isRecord(schema.additionalProperties)) check(child, schema.additionalProperties, `${path}.${name}`, errors);
    }
  }
}

function isType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return isRecord(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  return `a ${typeof value}`;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
