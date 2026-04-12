import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

import type { GroupRule, Rule } from '@projectx/types';

// Constants inlined to avoid a runtime require() of the @projectx/types TS source.
// Keep in sync with packages/types/src/query.ts.
const RULE_FIELDS = [
  'title',
  'publisher',
  'language',
  'series',
  'seriesIndex',
  'publishedYear',
  'pageCount',
  'author',
  'genre',
  'tag',
  'collection',
  'library',
  'format',
  'addedAt',
  'fileAvailability',
  'rating',
  'readProgress',
  'description',
  'isbn',
  'metadataScore',
] as const;
const RULE_OPERATORS = [
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'eq',
  'notEq',
  'isEmpty',
  'isNotEmpty',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'includesAny',
  'includesAll',
  'excludesAll',
  'before',
  'after',
  'withinLast',
  'isMissing',
  'isPresent',
  'isUnread',
  'isInProgress',
  'isFinished',
] as const;

const VALID_OPERATORS_BY_FIELD: Record<string, string[]> = {
  title: ['contains', 'notContains', 'startsWith', 'endsWith', 'eq', 'notEq', 'isEmpty', 'isNotEmpty'],
  publisher: ['contains', 'notContains', 'eq', 'notEq', 'includesAny', 'excludesAll', 'isEmpty', 'isNotEmpty'],
  language: ['eq', 'notEq', 'includesAny', 'excludesAll', 'isEmpty', 'isNotEmpty'],
  series: ['contains', 'notContains', 'eq', 'notEq', 'includesAny', 'excludesAll', 'isEmpty', 'isNotEmpty'],
  author: ['includesAny', 'includesAll', 'excludesAll', 'isEmpty', 'isNotEmpty'],
  genre: ['includesAny', 'includesAll', 'excludesAll', 'isEmpty', 'isNotEmpty'],
  tag: ['includesAny', 'includesAll', 'excludesAll', 'isEmpty', 'isNotEmpty'],
  collection: ['includesAny', 'excludesAll', 'isEmpty', 'isNotEmpty'],
  library: ['includesAny', 'excludesAll'],
  format: ['includesAny', 'excludesAll'],
  publishedYear: ['eq', 'notEq', 'gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'isNotEmpty'],
  seriesIndex: ['eq', 'notEq', 'gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'isNotEmpty'],
  pageCount: ['gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'isNotEmpty'],
  addedAt: ['before', 'after', 'between', 'withinLast'],
  fileAvailability: ['isMissing', 'isPresent'],
  rating: ['eq', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'isNotEmpty'],
  readProgress: ['isUnread', 'isInProgress', 'isFinished'],
  description: ['isEmpty', 'isNotEmpty'],
  isbn: ['isEmpty', 'isNotEmpty', 'eq'],
  metadataScore: ['gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'isNotEmpty'],
};

const ruleSchema: z.ZodType<Rule> = z
  .object({
    type: z.literal('rule'),
    field: z.enum(RULE_FIELDS),
    operator: z.enum(RULE_OPERATORS),
    value: z.union([z.string(), z.number(), z.array(z.string().min(1)).min(1).max(20), z.array(z.number()).min(1).max(20)]).optional(),
    valueTo: z.union([z.string(), z.number()]).optional(),
  })
  .refine((rule) => !!VALID_OPERATORS_BY_FIELD[rule.field]?.includes(rule.operator), {
    message: 'Operator is not valid for this field',
  }) as z.ZodType<Rule>;

const groupRuleSchema = (maxDepth: number): z.ZodType<GroupRule> =>
  z.object({
    type: z.literal('group'),
    join: z.enum(['AND', 'OR']),
    rules: z.array(maxDepth <= 1 ? ruleSchema : z.union([ruleSchema, z.lazy(() => groupRuleSchema(maxDepth - 1))])).min(1),
  }) as z.ZodType<GroupRule>;

export { groupRuleSchema };

export function validateGroupRule(value: unknown): GroupRule | null {
  if (value === null || value === undefined) return null;
  const result = groupRuleSchema(5).safeParse(value);
  if (!result.success) throw new BadRequestException({ message: 'Invalid filter', errors: result.error.flatten() });
  return result.data;
}
