import { Controller, Body, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Put } from '@nestjs/common';
import { Permission } from '@projectx/types';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { UpdateGlobalPreferencesDto } from './dto/update-global-preferences.dto';
import { UpdateLibraryOverridesDto } from './dto/update-library-overrides.dto';
import { MetadataPreferencesService } from './metadata-preferences.service';

@Controller('metadata-preferences')
@RequirePermission(Permission.ManageMetadataConfig)
export class MetadataPreferencesController {
  constructor(private readonly service: MetadataPreferencesService) {}

  @Get('global')
  getGlobal() {
    return this.service.getGlobal();
  }

  @Put('global')
  @HttpCode(HttpStatus.OK)
  setGlobal(@Body() dto: UpdateGlobalPreferencesDto) {
    return this.service.setGlobal(dto);
  }

  @Get('libraries/:id')
  getForLibrary(@Param('id', ParseIntPipe) id: number) {
    return this.service.getForLibrary(id);
  }

  @Put('libraries/:id')
  @HttpCode(HttpStatus.OK)
  setLibraryOverrides(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLibraryOverridesDto) {
    return this.service.setLibraryOverrides(id, dto.overrides);
  }

  @Delete('global')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetGlobal() {
    return this.service.resetGlobal();
  }

  @Delete('libraries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetLibraryToGlobal(@Param('id', ParseIntPipe) id: number) {
    return this.service.resetLibraryToGlobal(id);
  }
}
