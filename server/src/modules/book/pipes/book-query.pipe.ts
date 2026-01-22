import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { z } from 'zod';

import type { BookQuery, GroupRule, Rule } from '@projectx/types';

// Inlined here to avoid a runtime require() of the @projectx/types TS source.
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
  'tag',
  'format',
  'addedAt',
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
] as const;

const SORT_FIELDS = ['title', 'addedAt', 'publishedYear', 'pageCount', 'seriesIndex'] as const;

const VALID_OPERATORS_BY_FIELD: Record<string, string[]> = {
  title: ['contains', 'notContains', 'startsWith', 'endsWith', 'eq', 'notEq', 'isEmpty', 'isNotEmpty'],
  publisher: ['contains', 'notContains', 'isEmpty', 'isNotEmpty'],
  language: ['eq', 'notEq', 'isEmpty', 'isNotEmpty'],
  series: ['contains', 'notContains', 'isEmpty', 'isNotEmpty'],
  author: ['includesAny', 'includesAll', 'excludesAll', 'isEmpty', 'isNotEmpty'],
  tag: ['includesAny', 'includesAll', 'excludesAll', 'isEmpty', 'isNotEmpty'],
  format: ['includesAny', 'excludesAll'],
  publishedYear: ['eq', 'notEq', 'gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'isNotEmpty'],
  seriesIndex: ['eq', 'notEq', 'gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'isNotEmpty'],
  pageCount: ['gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'isNotEmpty'],
  addedAt: ['before', 'after', 'between', 'withinLast'],
};

const ruleSchema: z.ZodType<Rule> = z
  .object({
    type: z.literal('rule'),
    field: z.enum(RULE_FIELDS),
    operator: z.enum(RULE_OPERATORS),
    value: z.union([z.string(), z.number(), z.array(z.string()).max(20), z.array(z.number()).max(20)]).optional(),
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

const bookQuerySchema = z.object({
  filter: groupRuleSchema(5).optional(),
  sort: z
    .array(
      z.object({
        field: z.enum(SORT_FIELDS),
        dir: z.enum(['asc', 'desc']),
      }),
    )
    .max(5)
    .default([]),
  pagination: z
    .object({
      page: z.number().int().min(0).default(0),
      size: z.number().int().min(1).max(200).default(50),
    })
    .default({ page: 0, size: 50 }),
});

@Injectable()
export class BookQueryPipe implements PipeTransform {
  transform(value: unknown): BookQuery {
    const result = bookQuerySchema.safeParse(value ?? {});
    if (!result.success) throw new BadRequestException(result.error.flatten());
    return result.data as BookQuery;
  }
}
