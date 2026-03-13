import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { Permission } from '@projectx/types';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { UpdateWeightsDto } from './dto/update-weights.dto';
import { MetadataScoreService } from './metadata-score.service';

@Controller('metadata-score')
export class MetadataScoreController {
  constructor(private readonly service: MetadataScoreService) {}

  @Get('weights')
  async getWeights() {
    return this.service.getWeights();
  }

  @Patch('weights')
  @RequirePermission(Permission.ManageAppSettings)
  async updateWeights(@Body() dto: UpdateWeightsDto) {
    return this.service.updateWeights(dto);
  }

  @Post('recalculate')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission(Permission.ManageAppSettings)
  recalculate() {
    this.service.recalculateAll().catch(() => undefined);
    return { message: 'Recalculation started' };
  }
}
