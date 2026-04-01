import { Controller, Get, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { SearchCatalogQueryDto } from './dto/search-catalog-query.dto';
import { CatalogService } from './catalog.service';

@Controller('metadata')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('authors')
  searchAuthors(@Query() query: SearchCatalogQueryDto) {
    return this.catalogService.searchAuthors(query.q);
  }

  @Get('genres')
  searchGenres(@Query() query: SearchCatalogQueryDto) {
    return this.catalogService.searchGenres(query.q);
  }

  @Get('tags')
  searchTags(@Query() query: SearchCatalogQueryDto) {
    return this.catalogService.searchTags(query.q);
  }

  @Get('narrators')
  searchNarrators(@Query() query: SearchCatalogQueryDto) {
    return this.catalogService.searchNarrators(query.q);
  }

  @Get('publishers')
  searchPublishers(@Query() query: SearchCatalogQueryDto) {
    return this.catalogService.searchPublishers(query.q);
  }

  @Get('series')
  searchSeries(@Query() query: SearchCatalogQueryDto) {
    return this.catalogService.searchSeries(query.q);
  }

  @Get('languages')
  searchLanguages(@Query() query: SearchCatalogQueryDto) {
    return this.catalogService.searchLanguages(query.q);
  }

  @Get('collections')
  searchCollections(@CurrentUser() user: RequestUser, @Query() query: SearchCatalogQueryDto) {
    return this.catalogService.searchCollections(user.id, query.q);
  }
}
