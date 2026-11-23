import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { Permission, type BookEditionSuggestions } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookEditionSuggestionsService } from './book-edition-suggestions.service';

/** Gated like grouping editions itself: a suggestion is only useful to someone who may act on it. */
@Controller('books')
export class BookEditionSuggestionsController {
  constructor(private readonly service: BookEditionSuggestionsService) {}

  @Get(':id/edition-suggestions')
  @RequirePermission(Permission.LibraryEditMetadata)
  suggest(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser): Promise<BookEditionSuggestions> {
    return this.service.suggest(id, user);
  }
}
