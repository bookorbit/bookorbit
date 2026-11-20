import { and, or, sql, type SQL } from 'drizzle-orm';
import type { JobView } from '@bookorbit/types';

/**
 * A row's place in a view's order. Queue: prefix `(group, rank)`, suffix `(at)`. Needs you, Failed
 * and History: prefix `(at)`, no suffix. Timestamps are epoch microseconds, below 2^53 and so exact
 * in a JS number. `id` is the type's own id: a number, or a string compared byte by byte.
 */
export interface JobKey {
  prefix: number[];
  suffix: number[];
  id: string | number;
}

/** A key with the type it belongs to; the type's place in `JOB_TYPES` sits between prefix and suffix. */
export interface JobPosition extends JobKey {
  typeIndex: number;
}

/**
 * How a source reads one key component. `time` is a non-null timestamptz, compared against the raw
 * expression so an index on it stays usable. `text` compares byte by byte, as JS does.
 */
export type KeyPart = { kind: 'number'; expr: SQL } | { kind: 'time'; expr: SQL } | { kind: 'uuid'; expr: SQL } | { kind: 'text'; expr: SQL };

export interface KeysetColumns {
  prefix: KeyPart[];
  suffix: KeyPart[];
  id: KeyPart;
}

/** How many prefix and suffix values a key holds in each view. */
export const JOB_KEY_SHAPE: Record<JobView, { prefix: number; suffix: number }> = {
  queue: { prefix: 2, suffix: 1 },
  'needs-you': { prefix: 1, suffix: 0 },
  failed: { prefix: 1, suffix: 0 },
  history: { prefix: 1, suffix: 0 },
};

/** The Queue runs oldest first; every other view shows the newest first. Ties between types always go by type order. */
export function jobViewDirection(view: JobView): 'asc' | 'desc' {
  return view === 'queue' ? 'asc' : 'desc';
}

/** Selects a timestamp as integer epoch microseconds, exact for building a key. Never build a key from a JS `Date`. */
export function microseconds(expr: SQL): SQL<number> {
  return sql<number>`(extract(epoch from ${expr}) * 1000000)::bigint`.mapWith(Number);
}

function operand(part: KeyPart): SQL {
  return part.kind === 'text' ? sql`${part.expr} collate "C"` : part.expr;
}

function value(part: KeyPart, raw: string | number): SQL {
  switch (part.kind) {
    case 'time':
      return sql`(timestamptz 'epoch' + ${raw}::bigint * interval '1 microsecond')`;
    case 'uuid':
      return sql`${raw}::uuid`;
    case 'number':
      return sql`${raw}`;
    case 'text':
      return sql`${String(raw)}`;
  }
}

function compare(part: KeyPart, raw: string | number, op: '<' | '>' | '='): SQL {
  return sql`${operand(part)} ${sql.raw(op)} ${value(part, raw)}`;
}

/** Rows whose components come strictly after (or, with `orEqual`, at or after) these values, expanded so each comparison can use an index. */
function lexAfter(parts: readonly KeyPart[], values: readonly (string | number)[], direction: 'asc' | 'desc', orEqual: boolean): SQL {
  const op = direction === 'asc' ? '>' : '<';
  const clauses: SQL[] = parts.map((part, index) =>
    and(...parts.slice(0, index).map((earlier, at) => compare(earlier, values[at]!, '=')), compare(part, values[index]!, op))!,
  );
  if (orEqual) clauses.push(and(...parts.map((part, at) => compare(part, values[at]!, '=')))!);
  return or(...clauses)!;
}

/**
 * Rows of the source at `typeIndex` that come after `position` in the merged order. Components
 * before the type form the prefix. A type earlier than the cursor's needs a strictly later prefix;
 * a later type needs a prefix at or after it; the cursor's own type compares the full key.
 */
export function afterPosition(columns: KeysetColumns, view: JobView, position: JobPosition, typeIndex: number): SQL {
  const direction = jobViewDirection(view);
  if (typeIndex < position.typeIndex) return lexAfter(columns.prefix, position.prefix, direction, false);
  if (typeIndex > position.typeIndex) return lexAfter(columns.prefix, position.prefix, direction, true);
  return lexAfter([...columns.prefix, ...columns.suffix, columns.id], [...position.prefix, ...position.suffix, position.id], direction, false);
}

/** The source's own order for a view, matching `compareJobPositions` for its rows. */
export function keysetOrder(columns: KeysetColumns, view: JobView): SQL[] {
  const direction = sql.raw(jobViewDirection(view));
  return [...columns.prefix, ...columns.suffix, columns.id].map((part) => sql`${operand(part)} ${direction}`);
}

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareLists(a: readonly (string | number)[], b: readonly (string | number)[]): number {
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const diff = compareValues(a[index]!, b[index]!);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}

/** The merged order across types: prefix, then type order (always ascending), then suffix and id. */
export function compareJobPositions(view: JobView, a: JobPosition, b: JobPosition): number {
  const sign = jobViewDirection(view) === 'asc' ? 1 : -1;
  const prefix = compareLists(a.prefix, b.prefix);
  if (prefix !== 0) return sign * prefix;
  if (a.typeIndex !== b.typeIndex) return a.typeIndex - b.typeIndex;
  const suffix = compareLists(a.suffix, b.suffix);
  if (suffix !== 0) return sign * suffix;
  return sign * compareValues(a.id, b.id);
}
