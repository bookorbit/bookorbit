import { BadRequestException } from '@nestjs/common';

import { COMMUNITY_RATING_PROVIDER_KEYS, FIELD_OPERATORS, RULE_OPERATORS, type RuleField, type RuleOperator } from '@bookorbit/types';

import { validateGroupRule, groupRuleSchema } from './group-rule.validator';

/**
 * Returns a minimal { value, valueTo } pair that satisfies the Zod schema for a
 * given field/operator pair. The validator checks operator-field compatibility,
 * value type (string | number | string[] | number[]), and - for date fields with
 * before/after/between - that the value(s) parse to a real date, so date fields
 * need real date strings here while everything else can use structurally valid stubs.
 *
 * The exhaustive `never` default ensures TypeScript raises a compile error when a
 * new operator is added to RuleOperator but not handled in this helper.
 */
const DATE_FIELDS: RuleField[] = ['addedAt', 'startedAt', 'finishedAt', 'publishedDate'];

function validRuleValue(operator: RuleOperator, field: RuleField): { value?: unknown; valueTo?: unknown } {
  switch (operator) {
    case 'isEmpty':
    case 'isNotEmpty':
    case 'isMissing':
    case 'isPresent':
    case 'isUnread':
    case 'isInProgress':
    case 'isFinished':
    case 'isLocked':
    case 'isUnlocked':
    case 'isUpNext':
      return {};
    case 'before':
    case 'after':
      return { value: '2024-01-01' };
    case 'contains':
    case 'notContains':
    case 'startsWith':
    case 'endsWith':
    case 'eq':
    case 'notEq':
      return { value: 'test' };
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
    case 'withinLast':
      return { value: 1 };
    case 'between':
      return DATE_FIELDS.includes(field) ? { value: '2024-01-01', valueTo: '2024-06-01' } : { value: 1, valueTo: 2 };
    case 'includesAny':
    case 'includesAll':
    case 'excludesAll':
      return { value: ['test'] };
    default: {
      const _exhaustive: never = operator;
      return _exhaustive;
    }
  }
}

describe('validateGroupRule', () => {
  it('returns null for null input', () => {
    expect(validateGroupRule(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(validateGroupRule(undefined)).toBeNull();
  });

  it('accepts a valid simple group rule', () => {
    const rule = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Dune' }],
    };

    const result = validateGroupRule(rule);
    expect(result).toEqual(rule);
  });

  it('accepts valid OR join', () => {
    const rule = {
      type: 'group',
      join: 'OR',
      rules: [{ type: 'rule', field: 'author', operator: 'includesAny', value: ['Frank Herbert'] }],
    };
    expect(validateGroupRule(rule)).toEqual(rule);
  });

  it('throws BadRequestException for invalid field', () => {
    const rule = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'nonexistentField', operator: 'contains', value: 'x' }],
    };
    expect(() => validateGroupRule(rule)).toThrow(BadRequestException);
  });

  it('throws BadRequestException when operator is not valid for the field', () => {
    // 'author' does not support 'contains'
    const rule = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'author', operator: 'contains', value: 'Frank' }],
    };
    expect(() => validateGroupRule(rule)).toThrow(BadRequestException);
  });

  it('accepts nested groups up to max depth 5', () => {
    const deepRule = {
      type: 'group',
      join: 'AND',
      rules: [
        {
          type: 'group',
          join: 'OR',
          rules: [
            {
              type: 'group',
              join: 'AND',
              rules: [
                {
                  type: 'group',
                  join: 'OR',
                  rules: [
                    {
                      type: 'group',
                      join: 'AND',
                      rules: [{ type: 'rule', field: 'title', operator: 'eq', value: 'deep' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(() => validateGroupRule(deepRule)).not.toThrow();
  });

  it('throws BadRequestException for empty rules array', () => {
    const rule = { type: 'group', join: 'AND', rules: [] };
    expect(() => validateGroupRule(rule)).toThrow(BadRequestException);
  });

  it('throws BadRequestException for missing join field', () => {
    const rule = { type: 'group', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'x' }] };
    expect(() => validateGroupRule(rule)).toThrow(BadRequestException);
  });

  it('accepts numeric value for numeric fields', () => {
    const rule = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'publishedYear', operator: 'gt', value: 2000 }],
    };
    expect(validateGroupRule(rule)).toBeDefined();
  });

  it('accepts between operator with valueTo', () => {
    const rule = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'publishedYear', operator: 'between', value: 2000, valueTo: 2020 }],
    };
    expect(validateGroupRule(rule)).toBeDefined();
  });

  it('accepts a community rating rule with an explicit provider', () => {
    const rule = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'communityRating', operator: 'gte', value: 4.5, provider: COMMUNITY_RATING_PROVIDER_KEYS[0] }],
    };

    expect(validateGroupRule(rule)).toEqual(rule);
  });

  it('accepts a community rating rule with any provider', () => {
    const rule = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'communityRating', operator: 'gte', value: 4.5, provider: 'any' }],
    };

    expect(validateGroupRule(rule)).toEqual(rule);
  });

  it('accepts a community rating rule without provider for backwards compatibility', () => {
    const rule = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'communityRating', operator: 'gte', value: 4.5 }],
    };

    expect(validateGroupRule(rule)).toEqual(rule);
  });

  it('rejects provider on non-community-rating rules', () => {
    const rule = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'rating', operator: 'gte', value: 4, provider: 'amazon' }],
    };

    expect(() => validateGroupRule(rule)).toThrow(BadRequestException);
  });

  it('rejects providers that do not expose community ratings', () => {
    const rule = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'communityRating', operator: 'gte', value: 4.5, provider: 'kobo' }],
    };

    expect(() => validateGroupRule(rule)).toThrow(BadRequestException);
  });

  it('accepts array values for includesAny operators', () => {
    const rule = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'genre', operator: 'includesAny', value: ['Fiction', 'Sci-Fi'] }],
    };
    expect(validateGroupRule(rule)).toBeDefined();
  });

  it('throws BadRequestException for non-object input', () => {
    expect(() => validateGroupRule('invalid')).toThrow(BadRequestException);
    expect(() => validateGroupRule(42)).toThrow(BadRequestException);
    expect(() => validateGroupRule([])).toThrow(BadRequestException);
  });

  it('accepts isEmpty operator with no value', () => {
    const rule = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'title', operator: 'isEmpty' }],
    };
    expect(validateGroupRule(rule)).toBeDefined();
  });

  it('throws BadRequestException for fileAvailability with invalid operator', () => {
    // fileAvailability only supports isMissing and isPresent
    const rule = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'fileAvailability', operator: 'contains', value: 'x' }],
    };
    expect(() => validateGroupRule(rule)).toThrow(BadRequestException);
  });

  it('accepts readProgress with isUnread operator', () => {
    const rule = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'readProgress', operator: 'isUnread' }],
    };
    expect(validateGroupRule(rule)).toBeDefined();
  });

  it('throws BadRequestException for array with more than 20 items', () => {
    const rule = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'author', operator: 'includesAny', value: Array(21).fill('Author') }],
    };
    expect(() => validateGroupRule(rule)).toThrow(BadRequestException);
  });

  it('accepts cover with isMissing operator', () => {
    const rule = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'cover', operator: 'isMissing' }],
    };
    expect(validateGroupRule(rule)).toBeDefined();
  });

  it('accepts cover with isPresent operator', () => {
    const rule = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'cover', operator: 'isPresent' }],
    };
    expect(validateGroupRule(rule)).toBeDefined();
  });

  it('throws BadRequestException for cover with invalid operator', () => {
    const rule = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'cover', operator: 'contains', value: 'x' }],
    };
    expect(() => validateGroupRule(rule)).toThrow(BadRequestException);
  });
});

describe('date field value validation', () => {
  const DATE_FIELDS_UNDER_TEST: RuleField[] = ['addedAt', 'startedAt', 'finishedAt', 'publishedDate'];

  it.each(DATE_FIELDS_UNDER_TEST)("rejects a 2-digit year for '%s' before/after/between (issue #787 regression)", (field) => {
    const before = { type: 'group', join: 'AND', rules: [{ type: 'rule', field, operator: 'before', value: '21-12-31' }] };
    const after = { type: 'group', join: 'AND', rules: [{ type: 'rule', field, operator: 'after', value: '21-12-31' }] };
    const between = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field, operator: 'between', value: '2023-01-01', valueTo: '21-12-31' }],
    };

    expect(() => validateGroupRule(before)).toThrow(BadRequestException);
    expect(() => validateGroupRule(after)).toThrow(BadRequestException);
    expect(() => validateGroupRule(between)).toThrow(BadRequestException);
  });

  it.each(DATE_FIELDS_UNDER_TEST)("rejects a non-date string for '%s' with before", (field) => {
    const rule = { type: 'group', join: 'AND', rules: [{ type: 'rule', field, operator: 'before', value: 'not-a-date' }] };
    expect(() => validateGroupRule(rule)).toThrow(BadRequestException);
  });

  it.each(DATE_FIELDS_UNDER_TEST)("rejects a missing value for '%s' with after", (field) => {
    const rule = { type: 'group', join: 'AND', rules: [{ type: 'rule', field, operator: 'after' }] };
    expect(() => validateGroupRule(rule)).toThrow(BadRequestException);
  });

  it.each(DATE_FIELDS_UNDER_TEST)("rejects a valid value with a malformed valueTo for '%s' between", (field) => {
    const rule = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field, operator: 'between', value: '2023-01-01', valueTo: 'nope' }],
    };
    expect(() => validateGroupRule(rule)).toThrow(BadRequestException);
  });

  it.each(DATE_FIELDS_UNDER_TEST)("accepts a well-formed YYYY-MM-DD value for '%s' before/after/between", (field) => {
    const before = { type: 'group', join: 'AND', rules: [{ type: 'rule', field, operator: 'before', value: '2024-01-01' }] };
    const after = { type: 'group', join: 'AND', rules: [{ type: 'rule', field, operator: 'after', value: '2024-01-01' }] };
    const between = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field, operator: 'between', value: '2023-01-01', valueTo: '2024-01-01' }],
    };

    expect(() => validateGroupRule(before)).not.toThrow();
    expect(() => validateGroupRule(after)).not.toThrow();
    expect(() => validateGroupRule(between)).not.toThrow();
  });

  it.each(DATE_FIELDS_UNDER_TEST)("accepts a zero-padded year below 1000 for '%s'", (field) => {
    const rule = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field, operator: 'before', value: '0021-12-31' }],
    };
    expect(validateGroupRule(rule)).toBeDefined();
  });

  it.each(DATE_FIELDS_UNDER_TEST)("accepts a valid ISO timestamp for '%s'", (field) => {
    const rule = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field, operator: 'before', value: '2026-01-01T02:30:00.000Z' }],
    };
    expect(validateGroupRule(rule)).toBeDefined();
  });

  it('rejects a calendar-invalid date like 2024-02-30 even though the regex shape matches', () => {
    const rule = { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'finishedAt', operator: 'before', value: '2024-02-30' }] };
    expect(() => validateGroupRule(rule)).toThrow(BadRequestException);
  });

  it('rejects an ISO timestamp whose calendar date is invalid', () => {
    const rule = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'finishedAt', operator: 'before', value: '2024-02-30T00:00:00.000Z' }],
    };
    expect(() => validateGroupRule(rule)).toThrow(BadRequestException);
  });

  it('rejects an ISO timestamp whose time is invalid', () => {
    const rule = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'finishedAt', operator: 'before', value: '2024-02-29T24:00:00.000Z' }],
    };
    expect(() => validateGroupRule(rule)).toThrow(BadRequestException);
  });

  it('does not require date-shaped values for withinLast (a day count, not a date)', () => {
    const rule = { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'finishedAt', operator: 'withinLast', value: 30 }] };
    expect(validateGroupRule(rule)).toBeDefined();
  });

  it('does not apply date validation to non-date fields sharing the between operator', () => {
    const rule = { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'pageCount', operator: 'between', value: 100, valueTo: 300 }] };
    expect(validateGroupRule(rule)).toBeDefined();
  });

  it('accepts a finite epoch value supported by the query builder', () => {
    const rule = { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'addedAt', operator: 'before', value: Date.UTC(2024, 0, 1) }] };
    expect(validateGroupRule(rule)).toBeDefined();
  });
});

describe('groupRuleSchema depth enforcement', () => {
  it('groups at depth 5 are valid', () => {
    const schema = groupRuleSchema(5);
    const result = schema.safeParse({
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'x' }],
    });
    expect(result.success).toBe(true);
  });

  it('at maxDepth 1, child groups are rejected', () => {
    const schema = groupRuleSchema(1);
    const result = schema.safeParse({
      type: 'group',
      join: 'AND',
      rules: [
        {
          type: 'group',
          join: 'OR',
          rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'x' }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('field × operator exhaustive validation', () => {
  it.each(Object.entries(FIELD_OPERATORS) as [RuleField, RuleOperator[]][])('accepts all valid operators for field: %s', (field, operators) => {
    for (const operator of operators) {
      const { value, valueTo } = validRuleValue(operator, field);
      const rule: Record<string, unknown> = { type: 'rule', field, operator };
      if (value !== undefined) rule.value = value;
      if (valueTo !== undefined) rule.valueTo = valueTo;

      expect(
        () => validateGroupRule({ type: 'group', join: 'AND', rules: [rule] }),
        `field '${field}' should accept operator '${operator}'`,
      ).not.toThrow();
    }
  });

  it.each(Object.entries(FIELD_OPERATORS) as [RuleField, RuleOperator[]][])('rejects a disallowed operator for field: %s', (field, operators) => {
    const disallowedOp = RULE_OPERATORS.find((op) => !operators.includes(op));
    if (!disallowedOp) return;

    const rule = { type: 'rule', field, operator: disallowedOp, value: 'test' };
    expect(() => validateGroupRule({ type: 'group', join: 'AND', rules: [rule] })).toThrow(BadRequestException);
  });
});
