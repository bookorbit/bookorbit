import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { Permission } from '@bookorbit/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { KoreaderAuthGuard } from './koreader-auth.guard';
import { KoreaderHashLinkService } from './koreader-hash-link.service';
import { KoreaderPackageService } from './koreader-package.service';
import { KoreaderService } from './koreader.service';
import {
  CreateKoreaderUserDto,
  DownloadPluginPackageDto,
  KoreaderDeviceParamDto,
  KoreaderSaveProgressDto,
  LinkKoreaderUnmatchedBookDto,
  TestConnectionDto,
  UpdateKoreaderDeviceFilePatternDto,
  UpdateKoreaderFilePatternDto,
  UpdateKoreaderManualHashLinkDto,
  UpdateKoreaderUserDto,
} from './dto';

@Controller('koreader')
export class KoreaderController {
  constructor(
    private readonly koreaderService: KoreaderService,
    private readonly hashLinkService: KoreaderHashLinkService,
    private readonly packageService: KoreaderPackageService,
  ) {}

  // --- KOReader kosync protocol endpoints (header-based auth) ---

  @Public()
  @UseGuards(KoreaderAuthGuard)
  @Get('users/auth')
  authenticateKoreader(@Headers('x-auth-user') koreaderUsername: string) {
    return { authorized: 'OK', username: koreaderUsername };
  }

  @Public()
  @Post('users/create')
  registerKoreader() {
    throw new ForbiddenException('Registration disabled. Create credentials in BookOrbit settings.');
  }

  @Public()
  @UseGuards(KoreaderAuthGuard)
  @Put('syncs/progress')
  async saveProgress(@CurrentUser() user: RequestUser, @Body() dto: KoreaderSaveProgressDto) {
    return this.koreaderService.saveProgress(user.id, dto);
  }

  @Public()
  @UseGuards(KoreaderAuthGuard)
  @Get('syncs/progress/:document')
  async getProgress(@CurrentUser() user: RequestUser, @Param('document') document: string) {
    const progress = await this.koreaderService.getProgress(user.id, document);
    return progress ?? {};
  }

  // --- BookOrbit management endpoints (JWT auth) ---

  @RequirePermission(Permission.KoreaderSync)
  @Post('credentials')
  async createCredentials(@CurrentUser() user: RequestUser, @Body() dto: CreateKoreaderUserDto) {
    await this.koreaderService.createCredentials(user.id, dto.username, dto.password);
    return { success: true };
  }

  @RequirePermission(Permission.KoreaderSync)
  @Patch('credentials')
  async updateCredentials(@CurrentUser() user: RequestUser, @Body() dto: UpdateKoreaderUserDto) {
    await this.koreaderService.updateCredentials(user.id, dto);
    return { success: true };
  }

  @RequirePermission(Permission.KoreaderSync)
  @Delete('credentials')
  async deleteCredentials(@CurrentUser() user: RequestUser) {
    await this.koreaderService.deleteCredentials(user.id);
    return { success: true };
  }

  @RequirePermission(Permission.KoreaderSync)
  @Get('credentials')
  async getCredentials(@CurrentUser() user: RequestUser) {
    return this.koreaderService.getCredentials(user.id);
  }

  @RequirePermission(Permission.KoreaderSync)
  @Get('sync-status')
  async getSyncStatus(@CurrentUser() user: RequestUser) {
    return this.koreaderService.getSyncStatus(user.id);
  }

  @RequirePermission(Permission.KoreaderSync)
  @Get('devices')
  async getDevices(@CurrentUser() user: RequestUser) {
    return this.koreaderService.getDevices(user.id);
  }

  @RequirePermission(Permission.KoreaderSync)
  @Get('file-naming-pattern')
  async getFileNamingPattern(@CurrentUser() user: RequestUser) {
    return { pattern: await this.koreaderService.getKoreaderUserDefaultPattern(user.id) };
  }

  @RequirePermission(Permission.KoreaderSync)
  @Put('file-naming-pattern')
  async setFileNamingPattern(@CurrentUser() user: RequestUser, @Body() dto: UpdateKoreaderFilePatternDto) {
    await this.koreaderService.setKoreaderUserDefaultPattern(user.id, dto.pattern);
    return dto;
  }

  @RequirePermission(Permission.KoreaderSync)
  @Put('devices/:deviceId/file-naming-pattern')
  async setDeviceFileNamingPattern(
    @CurrentUser() user: RequestUser,
    @Param() params: KoreaderDeviceParamDto,
    @Body() dto: UpdateKoreaderDeviceFilePatternDto,
  ) {
    await this.koreaderService.setDeviceFileNamingPattern(user.id, params.deviceId, {
      fileNamingPattern: dto.pattern,
      seriesFileNamingPattern: dto.seriesPattern,
      standaloneFileNamingPattern: dto.standalonePattern,
    });
    return dto;
  }

  @RequirePermission(Permission.KoreaderSync)
  @Delete('devices/:deviceId/file-naming-pattern')
  async clearDeviceFileNamingPattern(@CurrentUser() user: RequestUser, @Param() params: KoreaderDeviceParamDto) {
    await this.koreaderService.clearDeviceFileNamingPattern(user.id, params.deviceId);
    return { success: true };
  }

  @RequirePermission(Permission.KoreaderSync)
  @Delete('devices/:deviceId')
  async removeDevice(@CurrentUser() user: RequestUser, @Param() params: KoreaderDeviceParamDto) {
    await this.koreaderService.removeDevice(user.id, params.deviceId);
    return { success: true };
  }

  @RequirePermission(Permission.KoreaderSync)
  @Get('unmatched-books')
  listUnmatchedBooks(@CurrentUser() user: RequestUser) {
    return this.hashLinkService.listUnmatchedBooks(user);
  }

  @RequirePermission(Permission.KoreaderSync)
  @Post('unmatched-books/:hash/link')
  linkUnmatchedBook(@CurrentUser() user: RequestUser, @Param('hash') hash: string, @Body() dto: LinkKoreaderUnmatchedBookDto) {
    return this.hashLinkService.linkUnmatchedBook(user, hash, dto.bookId);
  }

  @RequirePermission(Permission.KoreaderSync)
  @Delete('unmatched-books/:hash')
  dismissUnmatchedBook(@CurrentUser() user: RequestUser, @Param('hash') hash: string) {
    return this.hashLinkService.dismissUnmatchedBook(user, hash);
  }

  @RequirePermission(Permission.KoreaderSync)
  @Delete('unmatched-books')
  dismissAllUnmatchedBooks(@CurrentUser() user: RequestUser) {
    return this.hashLinkService.dismissAllUnmatchedBooks(user);
  }

  @RequirePermission(Permission.KoreaderSync)
  @Get('hash-links')
  listManualHashLinks(@CurrentUser() user: RequestUser) {
    return this.hashLinkService.listManualHashLinks(user);
  }

  @RequirePermission(Permission.KoreaderSync)
  @Patch('hash-links/:hash')
  relinkManualHashLink(@CurrentUser() user: RequestUser, @Param('hash') hash: string, @Body() dto: UpdateKoreaderManualHashLinkDto) {
    return this.hashLinkService.relinkManualHashLink(user, hash, dto.bookId);
  }

  @RequirePermission(Permission.KoreaderSync)
  @Delete('hash-links/:hash')
  unlinkManualHashLink(@CurrentUser() user: RequestUser, @Param('hash') hash: string) {
    return this.hashLinkService.unlinkManualHashLink(user, hash);
  }

  @RequirePermission(Permission.KoreaderSync)
  @Get('books/:bookId/progress')
  getBookProgress(@CurrentUser() user: RequestUser, @Param('bookId', ParseIntPipe) bookId: number) {
    return this.koreaderService.getBookProgress(user.id, bookId);
  }

  @RequirePermission(Permission.KoreaderSync)
  @Get('plugin-package')
  async downloadPluginPackage(@CurrentUser() user: RequestUser, @Query() query: DownloadPluginPackageDto, @Res() reply: FastifyReply) {
    const zip = await this.packageService.buildPluginPackage(user.id, query.origin);
    reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', 'attachment; filename="bookorbit.koplugin.zip"')
      .header('Cache-Control', 'no-store')
      .send(zip);
  }

  @RequirePermission(Permission.KoreaderSync)
  @Post('test-connection')
  async testConnection(@CurrentUser() user: RequestUser, @Body() dto: TestConnectionDto) {
    const success = await this.koreaderService.testConnection(user.id, dto.username, dto.password);
    return { success, username: dto.username, serverUrl: '/api/v1/koreader' };
  }
}
