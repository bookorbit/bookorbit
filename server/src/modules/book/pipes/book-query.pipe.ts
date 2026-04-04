import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { z } from 'zod';

import type { BookQuery } from '@projectx/types';

import { groupRuleSchema } from '../utils/group-rule.validator';

const SORT_FIELDS = [
  'author',
  'title',
  'series',
  'seriesIndex',
  'addedAt',
  'updatedAt',
  'publishedYear',
  'pageCount',
  'rating',
  'publisher',
  'fileSize',
  'readProgress',
  'lastReadAt',
  'finishedAt',
  'random',
] as const;

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
