import type { TransformFnParams } from 'class-transformer';

/** Trims before validation, so a body of only whitespace fails the non-empty rule with a 400. */
export function trimJournalText({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}
