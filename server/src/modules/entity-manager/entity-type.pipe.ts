import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ALL_ENTITY_TYPES, type EntityType } from '@bookorbit/types';

@Injectable()
export class EntityTypePipe implements PipeTransform<string, EntityType> {
  transform(value: string): EntityType {
    if (!ALL_ENTITY_TYPES.includes(value as EntityType)) {
      throw new BadRequestException(`Invalid entity type: ${value}. Must be one of: ${ALL_ENTITY_TYPES.join(', ')}`);
    }
    return value as EntityType;
  }
}
