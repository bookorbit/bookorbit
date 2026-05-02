import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

import { FIELD_OPERATORS, RULE_FIELDS, RULE_OPERATORS, type GroupRule, type Rule } from '@bookorbit/types';

const ruleSchema: z.ZodType<Rule> = z
  .object({
    type: z.literal('rule'),
    field: z.enum(RULE_FIELDS as unknown as [string, ...string[]]),
    operator: z.enum(RULE_OPERATORS as unknown as [string, ...string[]]),
    value: z.union([z.string(), z.number(), z.array(z.string().min(1)).min(1).max(20), z.array(z.number()).min(1).max(20)]).optional(),
    valueTo: z.union([z.string(), z.number()]).optional(),
  })
  .refine((rule) => !!FIELD_OPERATORS[rule.field as keyof typeof FIELD_OPERATORS]?.includes(rule.operator as never), {
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
