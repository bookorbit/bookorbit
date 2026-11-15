import { BadRequestException } from '@nestjs/common';
import { JOB_SCOPES, JOB_TYPES, JOB_VIEWS, type JobScope, type JobType, type JobView } from '@bookorbit/types';

import { JOB_KEY_SHAPE, type JobPosition } from './job-keyset';

const CURSOR_VERSION = 1;
const NATIVE_ID = /^[A-Za-z0-9._-]{1,64}$/;
/** A cursor is minted by this server; one claiming a later time than this is not one of ours. */
const CLOCK_SLACK_MS = 60_000;

/**
 * Where a page starts: the list it belongs to, when its first page was read, and the last row shown.
 * A position, not a secret: every row is still authorized on each request.
 */
export interface JobCursor {
  view: JobView;
  type: JobType | null;
  scope: JobScope;
  /** When the first page loaded, in milliseconds. The failed window is measured from it, so rows do not move between Failed and History while paging. */
  asOf: number;
  position: JobPosition;
}

interface CursorWire {
  v: number;
  view: JobView;
  type: JobType | null;
  scope: JobScope;
  asOf: number;
  key: { p: number[]; s: number[]; t: number; i: string | number };
}

export function encodeJobCursor(cursor: JobCursor): string {
  const wire: CursorWire = {
    v: CURSOR_VERSION,
    view: cursor.view,
    type: cursor.type,
    scope: cursor.scope,
    asOf: cursor.asOf,
    key: { p: cursor.position.prefix, s: cursor.position.suffix, t: cursor.position.typeIndex, i: cursor.position.id },
  };
  return Buffer.from(JSON.stringify(wire), 'utf8').toString('base64url');
}

function refuse(): never {
  throw new BadRequestException('Invalid jobs cursor');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function safeIntegers(value: unknown, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length || !value.every((entry) => Number.isSafeInteger(entry))) refuse();
  return value as number[];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) refuse();
  return value as T;
}

/** Reads a cursor, refusing anything this server would not have minted with `400`. */
export function decodeJobCursor(raw: string, now = Date.now()): JobCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    refuse();
  }
  if (!isRecord(parsed) || !hasExactly(parsed, ['v', 'view', 'type', 'scope', 'asOf', 'key']) || parsed.v !== CURSOR_VERSION) refuse();
  const view = oneOf(parsed.view, JOB_VIEWS);
  const type = parsed.type === null ? null : oneOf(parsed.type, JOB_TYPES);
  const scope = oneOf(parsed.scope, JOB_SCOPES);
  const asOf = parsed.asOf;
  if (!Number.isSafeInteger(asOf) || (asOf as number) <= 0 || (asOf as number) > now + CLOCK_SLACK_MS) refuse();
  const key = parsed.key;
  if (!isRecord(key) || !hasExactly(key, ['p', 's', 't', 'i'])) refuse();
  const shape = JOB_KEY_SHAPE[view];
  const prefix = safeIntegers(key.p, shape.prefix);
  const suffix = safeIntegers(key.s, shape.suffix);
  const typeIndex = key.t;
  if (!Number.isInteger(typeIndex) || (typeIndex as number) < 0 || (typeIndex as number) >= JOB_TYPES.length) refuse();
  if (type !== null && typeIndex !== JOB_TYPES.indexOf(type)) refuse();
  const id = key.i;
  if (!(typeof id === 'string' && NATIVE_ID.test(id)) && !Number.isSafeInteger(id)) refuse();
  return { view, type, scope, asOf: asOf as number, position: { prefix, suffix, typeIndex: typeIndex as number, id: id as string | number } };
}
