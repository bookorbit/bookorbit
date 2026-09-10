import { Controller, Get, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { SearchCatalogQueryDto } from './dto/search-catalog-query.dto';
import { CatalogService } from './catalog.service';

@Controller('metadata')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('authors')
  searchAuthors(@CurrentUser() user: RequestUser, @Query() query: SearchCatalogQueryDto) {
    return this.catalogService.searchAuthors(user, query.q);
  }

  @Get('genres')
  searchGenres(@CurrentUser() user: RequestUser, @Query() query: SearchCatalogQueryDto) {
    return this.catalogService.searchGenres(user, query.q);
  }

  @Get('tags')
  searchTags(@CurrentUser() user: RequestUser, @Query() query: SearchCatalogQueryDto) {
    return this.catalogService.searchTags(user, query.q);
  }

  @Get('narrators')
  searchNarrators(@CurrentUser() user: RequestUser, @Query() query: SearchCatalogQueryDto) {
    return this.catalogService.searchNarrators(user, query.q);
  }

  @Get('publishers')
  searchPublishers(@CurrentUser() user: RequestUser, @Query() query: SearchCatalogQueryDto) {
    return this.catalogService.searchPublishers(user, query.q);
  }

  @Get('series')
  searchSeries(@CurrentUser() user: RequestUser, @Query() query: SearchCatalogQueryDto) {
    return this.catalogService.searchSeries(user, query.q);
  }

  @Get('languages')
  searchLanguages(@CurrentUser() user: RequestUser, @Query() query: SearchCatalogQueryDto) {
    return this.catalogService.searchLanguages(user, query.q);
  }

  @Get('collections')
  searchCollections(@CurrentUser() user: RequestUser, @Query() query: SearchCatalogQueryDto) {
    return this.catalogService.searchCollections(user.id, query.q);
  }
}
