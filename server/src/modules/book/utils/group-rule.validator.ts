import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

import {
  COMMUNITY_RATING_PROVIDER_KEYS,
  CUSTOM_FIELD_OPERATORS,
  FIELD_OPERATORS,
  RULE_OPERATORS,
  isCustomRuleField,
  isRuleField,
  type CommunityRatingProvider,
  type GroupRule,
  type Rule,
  type RuleOperator,
  type StaticRuleField,
} from '@bookorbit/types';
import { isDateKey } from '../../../common/utils/timezone.utils';

const COMMUNITY_RATING_PROVIDER_VALUES = ['any', ...COMMUNITY_RATING_PROVIDER_KEYS] as const;

const DATE_VALUE_FIELDS = new Set<StaticRuleField>(['addedAt', 'startedAt', 'finishedAt', 'publishedDate']);
const DATE_VALUE_OPERATORS = new Set<RuleOperator>(['before', 'after', 'between']);
const CUSTOM_NUMERIC_OPERATORS = new Set<RuleOperator>(['gt', 'gte', 'lt', 'lte']);
const CUSTOM_DATE_OPERATORS = new Set<RuleOperator>(['before', 'after']);
const ISO_DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isValidRuleDateValue(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value) && !Number.isNaN(new Date(value).getTime());
  }
  if (typeof value !== 'string') return false;

  const normalized = value.trim();
  if (isDateKey(normalized)) return true;

  const isoMatch = ISO_DATE_TIME_RE.exec(normalized);
  if (!isoMatch || !isDateKey(isoMatch[1]!)) return false;

  const hour = Number(isoMatch[2]);
  const minute = Number(isoMatch[3]);
  const second = Number(isoMatch[4]);
  return hour <= 23 && minute <= 59 && second <= 59 && !Number.isNaN(new Date(normalized).getTime());
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

type UnvalidatedRule = { field: string; operator: string; value?: unknown; valueTo?: unknown };

/**
 * A custom field rule carries no field type, so the value's own shape is what tells the query
 * builder which typed column to read. Reject the shapes that would otherwise silently read a
 * column the rule did not mean, rather than leaving them to return no rows.
 */
function checkCustomFieldValue(rule: UnvalidatedRule, ctx: z.RefinementCtx): void {
  const { operator, value, valueTo } = rule;
  if (Array.isArray(value)) {
    ctx.addIssue({ code: 'custom', message: 'Custom metadata field rules do not accept list values', path: ['value'] });
    return;
  }
  if (CUSTOM_NUMERIC_OPERATORS.has(operator as RuleOperator) && !isFiniteNumber(value)) {
    ctx.addIssue({ code: 'custom', message: `Operator '${operator}' requires a numeric value`, path: ['value'] });
    return;
  }
  if (CUSTOM_DATE_OPERATORS.has(operator as RuleOperator) && !isValidRuleDateValue(value)) {
    ctx.addIssue({ code: 'custom', message: `Operator '${operator}' requires a valid date value`, path: ['value'] });
    return;
  }
  if (operator === 'between') {
    // `value` picks the column the query builder reads, so `valueTo` has to suit that same column.
    const rangeIsValid = isFiniteNumber(value) ? isFiniteNumber(valueTo) : isValidRuleDateValue(value) && isValidRuleDateValue(valueTo);
    if (!rangeIsValid) {
      ctx.addIssue({ code: 'custom', message: "Operator 'between' requires two numbers or two dates", path: ['value'] });
    }
  }
}

const ruleSchema: z.ZodType<Rule> = z
  .object({
    type: z.literal('rule'),
    field: z.string().refine(isRuleField, { message: 'Unknown filter field' }),
    operator: z.enum(RULE_OPERATORS as unknown as [string, ...string[]]),
    value: z.union([z.string(), z.number(), z.array(z.string().min(1)).min(1).max(20), z.array(z.number()).min(1).max(20)]).optional(),
    valueTo: z.union([z.string(), z.number()]).optional(),
    provider: z.enum(COMMUNITY_RATING_PROVIDER_VALUES as unknown as [CommunityRatingProvider, ...CommunityRatingProvider[]]).optional(),
  })
  .superRefine((rule, ctx) => {
    const custom = isCustomRuleField(rule.field);
    // Narrowing a custom rule to its field's own operators would need a database lookup, so it is
    // checked against every operator a custom field can take; the query builder degrades the rest.
    const allowedOperators = custom ? CUSTOM_FIELD_OPERATORS : FIELD_OPERATORS[rule.field as StaticRuleField];
    if (!allowedOperators?.includes(rule.operator as RuleOperator)) {
      ctx.addIssue({ code: 'custom', message: 'Operator is not valid for this field', path: ['operator'] });
    }
    if (rule.provider !== undefined && rule.field !== 'communityRating' && rule.field !== 'communityRatingCount') {
      ctx.addIssue({
        code: 'custom',
        message: 'Provider is only valid for community rating rules and community rating count rules',
        path: ['provider'],
      });
    }
    if (custom) {
      checkCustomFieldValue(rule, ctx);
      return;
    }
    if (DATE_VALUE_FIELDS.has(rule.field as StaticRuleField) && DATE_VALUE_OPERATORS.has(rule.operator as RuleOperator)) {
      if (!isValidRuleDateValue(rule.value)) {
        ctx.addIssue({ code: 'custom', message: `Operator '${rule.operator}' requires a valid date value`, path: ['value'] });
      }
      if (rule.operator === 'between' && !isValidRuleDateValue(rule.valueTo)) {
        ctx.addIssue({ code: 'custom', message: `Operator '${rule.operator}' requires a valid date valueTo`, path: ['valueTo'] });
      }
    }
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
