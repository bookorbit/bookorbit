import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { AuditAction, AuditResource } from '@projectx/types';
import { AllowDefaultPassword } from '../../common/decorators/allow-default-password.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { OidcCallbackDto } from './dto/oidc-callback.dto';
import { OidcUnlinkDto } from './dto/oidc-unlink.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SetupDto } from './dto/setup.dto';
import { OidcService } from './oidc/oidc.service';

const ONE_MINUTE_MS = 60_000;
const ONE_HOUR_MS = 3_600_000;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly oidcService: OidcService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 3, ttl: ONE_MINUTE_MS } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Get('setup-status')
  setupStatus() {
    return this.authService.setupStatus();
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: ONE_MINUTE_MS } })
  @Post('setup')
  @HttpCode(HttpStatus.CREATED)
  setup(@Body() dto: SetupDto, @Headers('x-setup-token') setupToken: string | undefined, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.authService.setup(dto, setupToken, reply);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: ONE_MINUTE_MS } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.authService.login(dto, reply, req.ip);
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
  @AllowDefaultPassword()
  me(@CurrentUser() user: RequestUser) {
    return this.authService.buildUserResponse(user);
  }

  @Get('sessions')
  getSessions(@CurrentUser() user: RequestUser) {
    return this.authService.getSessions(user.id);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    action: AuditAction.AuthSessionRevoke,
    resource: AuditResource.User,
    getResourceId: (req) => parseInt(req.params['id'], 10),
    description: (req) => `Revoked session #${req.params['id']}`,
  })
  revokeSession(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) sessionId: number) {
    return this.authService.revokeSession(user.id, sessionId);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: ONE_HOUR_MS } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: FastifyRequest) {
    return this.authService.forgotPassword(dto, req.ip);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: ONE_MINUTE_MS } })
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: FastifyRequest) {
    return this.authService.resetPassword(dto, req.ip);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AllowDefaultPassword()
  changePassword(
    @CurrentUser() user: RequestUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.authService.changePassword(user.id, dto, reply, req.ip);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: ONE_MINUTE_MS } })
  @Post('oidc/:slug/state')
  @HttpCode(HttpStatus.OK)
  oidcGenerateState(@Param('slug') slug: string) {
    return this.oidcService.generateState(slug);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: ONE_MINUTE_MS } })
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

  @Throttle({ default: { limit: 5, ttl: ONE_MINUTE_MS } })
  @Post('oidc/:slug/link-state')
  @HttpCode(HttpStatus.OK)
  oidcGenerateLinkState(@CurrentUser() user: RequestUser, @Param('slug') slug: string) {
    return this.oidcService.generateLinkState(user.id, slug);
  }

  @Throttle({ default: { limit: 5, ttl: ONE_MINUTE_MS } })
  @Post('oidc/:slug/preview-state')
  @HttpCode(HttpStatus.OK)
  oidcGeneratePreviewState(@Param('slug') slug: string) {
    return this.oidcService.generatePreviewState(slug);
  }

  @Get('oidc/identities')
  oidcGetIdentities(@CurrentUser() user: RequestUser) {
    return this.oidcService.getLinkedIdentities(user.id);
  }

  @Delete('oidc/identities/:providerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  oidcUnlinkIdentity(@CurrentUser() user: RequestUser, @Param('providerId', ParseIntPipe) providerId: number, @Body() dto: OidcUnlinkDto) {
    return this.oidcService.unlinkIdentity(user.id, providerId, dto.password);
  }
}
