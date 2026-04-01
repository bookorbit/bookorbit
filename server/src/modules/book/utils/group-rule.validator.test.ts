import { BadRequestException } from '@nestjs/common';

import { FIELD_OPERATORS, RULE_OPERATORS, type RuleField, type RuleOperator } from '@projectx/types';

import { validateGroupRule, groupRuleSchema } from './group-rule.validator';

/**
 * Returns a minimal { value, valueTo } pair that satisfies the Zod schema for a
 * given operator. The validator only checks operator-field compatibility and
 * value type (string | number | string[] | number[]), not field-level semantics,
 * so any structurally valid value is sufficient here.
 *
 * The exhaustive `never` default ensures TypeScript raises a compile error when a
 * new operator is added to RuleOperator but not handled in this helper.
 */
function validRuleValue(operator: RuleOperator): { value?: unknown; valueTo?: unknown } {
  switch (operator) {
    case 'isEmpty':
    case 'isNotEmpty':
    case 'isMissing':
    case 'isPresent':
    case 'isUnread':
    case 'isInProgress':
    case 'isFinished':
      return {};
    case 'contains':
    case 'notContains':
    case 'startsWith':
    case 'endsWith':
    case 'eq':
    case 'notEq':
    case 'before':
    case 'after':
      return { value: 'test' };
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
    case 'withinLast':
      return { value: 1 };
    case 'between':
      return { value: 1, valueTo: 2 };
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
      const { value, valueTo } = validRuleValue(operator);
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
