import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { PreviewVoiceDto, SynthesizeDto } from './dto/synthesize.dto';
import { UpdateTtsPreferencesDto } from './dto/tts-preferences.dto';
import { SaveTtsPositionDto } from './dto/tts-position.dto';
import { ttsContentType } from './tts-audio-format';
import { TtsService } from './tts.service';

@Controller('tts')
export class TtsController {
  constructor(private readonly ttsService: TtsService) {}

  @Post('synthesize')
  async synthesize(@Body() dto: SynthesizeDto, @Res() reply: FastifyReply) {
    const buffer = await this.ttsService.synthesize(dto);
    void reply.header('Content-Type', ttsContentType(dto.format)).header('Content-Length', buffer.length).send(buffer);
  }

  /**
   * Audio with word timings, for readers that highlight along with narration. The audio is base64
   * because the timings have to travel with it; `synthesize` stays the raw-bytes path for callers
   * that do not need them.
   */
  @Post('synthesize/captioned')
  @HttpCode(200)
  synthesizeCaptioned(@Body() dto: SynthesizeDto) {
    return this.ttsService.synthesizeCaptioned(dto);
  }

  @Post('preview')
  async previewVoice(@Body() dto: PreviewVoiceDto, @Res() reply: FastifyReply) {
    const buffer = await this.ttsService.previewVoice(dto.providerId, dto.voiceId);
    void reply.header('Content-Type', 'audio/mpeg').header('Content-Length', buffer.length).send(buffer);
  }

  @Get('voices')
  getVoices(@Query('providerId') providerId?: string) {
    return this.ttsService.getVoices(providerId);
  }

  @Get('providers')
  getProviders() {
    return this.ttsService.getAvailableProviderInfos();
  }

  @Get('preferences')
  getUserPreferences(@CurrentUser() user: RequestUser) {
    return this.ttsService.getUserPreferences(user.id);
  }

  @Put('preferences')
  @HttpCode(200)
  saveUserPreferences(@Body() dto: UpdateTtsPreferencesDto, @CurrentUser() user: RequestUser) {
    return this.ttsService.saveUserPreferences(user.id, dto);
  }

  @Get('preferences/book/:bookId')
  getBookPreferences(@Param('bookId', ParseIntPipe) bookId: number, @CurrentUser() user: RequestUser) {
    return this.ttsService.getEffectiveBookPreferences(user.id, bookId, user);
  }

  @Put('preferences/book/:bookId')
  @HttpCode(200)
  saveBookPreferences(@Param('bookId', ParseIntPipe) bookId: number, @Body() dto: UpdateTtsPreferencesDto, @CurrentUser() user: RequestUser) {
    return this.ttsService.saveBookPreferences(user.id, bookId, dto, user);
  }

  @Delete('preferences/book/:bookId')
  @HttpCode(204)
  async deleteBookPreferences(@Param('bookId', ParseIntPipe) bookId: number, @CurrentUser() user: RequestUser) {
    await this.ttsService.deleteBookPreferences(user.id, bookId, user);
  }

  @Get('position/:bookFileId')
  getPosition(@Param('bookFileId', ParseIntPipe) bookFileId: number, @CurrentUser() user: RequestUser) {
    return this.ttsService.getPosition(user.id, bookFileId, user);
  }

  @Put('position/:bookFileId')
  @HttpCode(200)
  savePosition(@Param('bookFileId', ParseIntPipe) bookFileId: number, @Body() dto: SaveTtsPositionDto, @CurrentUser() user: RequestUser) {
    return this.ttsService.savePosition(user.id, bookFileId, dto, user);
  }

  @Delete('position/:bookFileId')
  @HttpCode(204)
  async deletePosition(@Param('bookFileId', ParseIntPipe) bookFileId: number, @CurrentUser() user: RequestUser) {
    await this.ttsService.deletePosition(user.id, bookFileId, user);
  }

  @Get('text/:bookFileId/:chapterIndex')
  getChapterText(
    @Param('bookFileId', ParseIntPipe) bookFileId: number,
    @Param('chapterIndex', ParseIntPipe) chapterIndex: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.ttsService.getChapterText(bookFileId, chapterIndex, user);
  }
}
