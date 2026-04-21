import { BadRequestException } from '@nestjs/common';
import { ALL_ENTITY_TYPES } from '@bookorbit/types';

import { EntityTypePipe } from './entity-type.pipe';

describe('EntityTypePipe', () => {
  const pipe = new EntityTypePipe();

  it.each(ALL_ENTITY_TYPES)('accepts valid entity type "%s"', (type) => {
    expect(pipe.transform(type)).toBe(type);
  });

  it('rejects unknown entity type', () => {
    expect(() => pipe.transform('invalid')).toThrow(BadRequestException);
    expect(() => pipe.transform('invalid')).toThrow('Invalid entity type: invalid');
  });

  it('rejects empty string', () => {
    expect(() => pipe.transform('')).toThrow(BadRequestException);
  });
});
