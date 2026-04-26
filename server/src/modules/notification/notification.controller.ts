import { Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, ParseIntPipe, Patch, Query } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ForbidPermission } from '../../common/decorators/forbid-permission.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { NotificationService } from './notification.service';

@Controller('notifications')
@RequirePermission(Permission.NotificationAccess)
@ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot access notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Query() dto: ListNotificationsDto) {
    return this.notificationService.list(user.id, dto.limit ?? 20, dto.offset ?? 0);
  }

  @Get('unread-count')
  async getUnreadCount(@CurrentUser() user: RequestUser) {
    const count = await this.notificationService.getUnreadCount(user.id);
    return { count };
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markAllAsRead(@CurrentUser() user: RequestUser) {
    await this.notificationService.markAllAsRead(user.id);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markAsRead(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number) {
    const updated = await this.notificationService.markAsRead(user.id, id);
    if (!updated) throw new NotFoundException('Notification not found');
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async dismiss(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number) {
    const deleted = await this.notificationService.dismiss(user.id, id);
    if (!deleted) throw new NotFoundException('Notification not found');
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearAll(@CurrentUser() user: RequestUser) {
    await this.notificationService.clearAll(user.id);
  }
}
