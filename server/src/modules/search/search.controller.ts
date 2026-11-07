import { Controller, Get, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { GlobalSearchDto } from './dto/global-search.dto';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(@Query() dto: GlobalSearchDto, @CurrentUser() user: RequestUser) {
    return this.searchService.search(user, dto);
  }
}
