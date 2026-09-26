import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put } from '@nestjs/common';

import { Permission } from '@bookorbit/types';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AddTtsProviderDto, ReorderTtsProvidersDto, UpdateTtsProviderDto } from './dto/tts-admin.dto';
import { TtsAdminService } from './tts-admin.service';

@Controller('tts/admin')
@RequirePermission(Permission.ManageAppSettings)
export class TtsAdminController {
  constructor(private readonly adminService: TtsAdminService) {}

  @Get('providers')
  getAllProviders() {
    return this.adminService.getAllProviders();
  }

  @Post('providers')
  addProvider(@Body() dto: AddTtsProviderDto) {
    return this.adminService.addProvider(dto);
  }

  @Put('providers/order')
  @HttpCode(204)
  async reorderProviders(@Body() dto: ReorderTtsProvidersDto) {
    await this.adminService.reorderProviders(dto.order);
  }

  @Put('providers/:id')
  @HttpCode(200)
  updateProvider(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTtsProviderDto) {
    return this.adminService.updateProvider(id, dto);
  }

  @Delete('providers/:id')
  @HttpCode(204)
  async deleteProvider(@Param('id', ParseIntPipe) id: number) {
    await this.adminService.deleteProvider(id);
  }

  @Get('providers/:id/voices/discover')
  discoverVoices(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.discoverProviderVoices(id);
  }

  @Post('providers/:id/test')
  testProvider(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.testProvider(id);
  }
}
