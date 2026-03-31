import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Put } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { UpsertPreferenceDto } from './dto/upsert-preference.dto';
import { ReaderPreferencesService } from './reader-preferences.service';

@Controller('reader')
export class ReaderPreferencesController {
  constructor(private readonly readerPreferencesService: ReaderPreferencesService) {}

  @Get('preferences/:bookFileId')
  async getPreference(@Param('bookFileId', ParseIntPipe) bookFileId: number, @CurrentUser() user: RequestUser) {
    const pref = await this.readerPreferencesService.getPreference(user, bookFileId);
    return { settings: pref?.settings ?? null, isCustomized: !!pref };
  }

  @Put('preferences/:bookFileId')
  @HttpCode(204)
  async upsertPreference(@Param('bookFileId', ParseIntPipe) bookFileId: number, @Body() dto: UpsertPreferenceDto, @CurrentUser() user: RequestUser) {
    await this.readerPreferencesService.upsertPreference(user, bookFileId, dto.settings);
  }

  @Delete('preferences/:bookFileId')
  @HttpCode(204)
  async deletePreference(@Param('bookFileId', ParseIntPipe) bookFileId: number, @CurrentUser() user: RequestUser) {
    await this.readerPreferencesService.deletePreference(user, bookFileId);
  }

  @Get('defaults')
  async getAllDefaults(@CurrentUser() user: RequestUser) {
    const rows = await this.readerPreferencesService.getAllDefaults(user.id);
    return Object.fromEntries(rows.map((r) => [r.formatGroup, r.settings]));
  }

  @Put('defaults/:formatGroup')
  @HttpCode(204)
  async upsertDefault(@Param('formatGroup') formatGroup: string, @Body() dto: UpsertPreferenceDto, @CurrentUser() user: RequestUser) {
    await this.readerPreferencesService.upsertDefault(user.id, formatGroup, dto.settings);
  }

  @Delete('defaults/:formatGroup')
  @HttpCode(204)
  async deleteDefault(@Param('formatGroup') formatGroup: string, @CurrentUser() user: RequestUser) {
    await this.readerPreferencesService.deleteDefault(user.id, formatGroup);
  }
}
