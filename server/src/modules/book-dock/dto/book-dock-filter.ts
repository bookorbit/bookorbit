import { applyDecorators } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { BOOK_DOCK_HOLD_FILTERS, BOOK_DOCK_UNSORTED_FILTER, type BookDockHoldFilter } from '@bookorbit/types';

import type { BookDockFilter } from '../book-dock.repository';

/** Nine digits keeps any id inside a Postgres integer. */
const DOCK_FILTER_PATTERN = /^(unsorted|[1-9]\d{0,8})$/;

/** The page's dock switcher: `unsorted`, or one library dock's id as a string. */
export function IsBookDockFilter(): PropertyDecorator {
  return applyDecorators(IsOptional(), IsString(), Matches(DOCK_FILTER_PATTERN));
}

/** The page's hold chips: `held`, `clear`, or one hold reason. */
export function IsBookDockHoldFilter(): PropertyDecorator {
  return applyDecorators(IsOptional(), IsIn(BOOK_DOCK_HOLD_FILTERS));
}

export function toBookDockFilter(value: { dock?: string; hold?: string }): BookDockFilter | undefined {
  const { dock, hold } = value;
  if (dock === undefined && hold === undefined) return undefined;
  return {
    ...(dock === undefined ? {} : { dock: dock === BOOK_DOCK_UNSORTED_FILTER ? ('unsorted' as const) : Number(dock) }),
    ...(hold === undefined ? {} : { hold: hold as BookDockHoldFilter }),
  };
}
