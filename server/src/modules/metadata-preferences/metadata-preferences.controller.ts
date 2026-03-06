import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Put } from '@nestjs/common';
import { ALL_METADATA_FIELDS } from '@projectx/types';
import type { FieldPreference, MetadataField } from '@projectx/types';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { UpdateGlobalPreferencesDto } from './dto/update-global-preferences.dto';
import { UpdateLibraryFieldDto } from './dto/update-library-field.dto';
import { MetadataPreferencesService } from './metadata-preferences.service';

@Controller('metadata-preferences')
@RequirePermission('manage_metadata_config')
export class MetadataPreferencesController {
  constructor(private readonly service: MetadataPreferencesService) {}

  private parseMetadataField(field: string): MetadataField {
    if ((ALL_METADATA_FIELDS as string[]).includes(field)) {
      return field as MetadataField;
    }
    throw new BadRequestException(`Unsupported metadata field: ${field}`);
  }

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

  @Put('libraries/:id/fields/:field')
  @HttpCode(HttpStatus.OK)
  setLibraryFieldOverride(@Param('id', ParseIntPipe) id: number, @Param('field') field: string, @Body() dto: UpdateLibraryFieldDto) {
    return this.service.setLibraryFieldOverride(id, this.parseMetadataField(field), dto as FieldPreference);
  }

  @Delete('libraries/:id/fields/:field')
  @HttpCode(HttpStatus.NO_CONTENT)
  clearLibraryFieldOverride(@Param('id', ParseIntPipe) id: number, @Param('field') field: string) {
    return this.service.setLibraryFieldOverride(id, this.parseMetadataField(field), null);
  }

  @Delete('libraries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetLibraryToGlobal(@Param('id', ParseIntPipe) id: number) {
    return this.service.resetLibraryToGlobal(id);
  }
}
