import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { OidcCallbackDto } from './dto/oidc-callback.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { OidcService } from './oidc/oidc.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly oidcService: OidcService,
  ) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.authService.login(dto, reply);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.authService.refresh(req, reply);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.authService.logout(req, reply);
  }

  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return this.authService.buildUserResponse(user);
  }

  @Get('sessions')
  getSessions(@CurrentUser() user: RequestUser) {
    return this.authService.getSessions(user.id);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeSession(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) sessionId: number) {
    return this.authService.revokeSession(user.id, sessionId);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(@CurrentUser() user: RequestUser, @Body() dto: ChangePasswordDto, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.authService.changePassword(user.id, dto, reply);
  }

  @Public()
  @Post('oidc/state')
  @HttpCode(HttpStatus.OK)
  oidcGenerateState() {
    return { state: this.oidcService.generateState() };
  }

  @Public()
  @Post('oidc/callback')
  @HttpCode(HttpStatus.OK)
  oidcCallback(@Body() dto: OidcCallbackDto, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.oidcService.handleCallback(dto, reply);
  }

  @Public()
  @Post('oidc/backchannel-logout')
  @HttpCode(HttpStatus.OK)
  oidcBackchannelLogout(@Req() req: FastifyRequest) {
    const body = req.body as Record<string, string> | undefined;
    const logoutToken = body?.['logout_token'] ?? '';
    return this.oidcService.handleBackchannelLogout(logoutToken);
  }
}
