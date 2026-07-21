import { Body, Controller, Get, HttpCode, Put } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { UpsertUserPreferenceDto } from './dto/upsert-user-preference.dto';
import { UserPreferencesService } from './user-preferences.service';

@Controller('user-preferences')
export class UserPreferencesController {
  constructor(private readonly userPreferencesService: UserPreferencesService) {}

  @Get('theme')
  async getThemePreferences(@CurrentUser() user: RequestUser) {
    const settings = await this.userPreferencesService.getThemePreferences(user.id);
    return { settings };
  }

  @Get('display')
  async getDisplayPreferences(@CurrentUser() user: RequestUser) {
    const settings = await this.userPreferencesService.getDisplayPreferences(user.id);
    return { settings };
  }

  @Put('theme')
  @HttpCode(204)
  async upsertThemePreferences(@Body() dto: UpsertUserPreferenceDto, @CurrentUser() user: RequestUser) {
    await this.userPreferencesService.upsertThemePreferences(user.id, dto.settings);
  }

  @Put('display')
  @HttpCode(204)
  async upsertDisplayPreferences(@Body() dto: UpsertUserPreferenceDto, @CurrentUser() user: RequestUser) {
    await this.userPreferencesService.upsertDisplayPreferences(user.id, dto.settings);
  }

  @Get('locale')
  async getLocalePreferences(@CurrentUser() user: RequestUser) {
    const settings = await this.userPreferencesService.getLocalePreferences(user.id);
    return { settings };
  }

  @Put('locale')
  @HttpCode(204)
  async upsertLocalePreferences(@Body() dto: UpsertUserPreferenceDto, @CurrentUser() user: RequestUser) {
    await this.userPreferencesService.upsertLocalePreferences(user.id, dto.settings);
  }

  @Get('whats-new')
  async getWhatsNewPreferences(@CurrentUser() user: RequestUser) {
    const settings = await this.userPreferencesService.getWhatsNewPreferences(user.id);
    return { settings };
  }

  @Put('whats-new')
  @HttpCode(204)
  async upsertWhatsNewPreferences(@Body() dto: UpsertUserPreferenceDto, @CurrentUser() user: RequestUser) {
    await this.userPreferencesService.upsertWhatsNewPreferences(user.id, dto.settings);
  }
}
