import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { FastifyReply } from 'fastify';

import { AuditAction, AuditResource } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { AUDIT_EVENT, AuditEventsService } from '../audit/audit-events.service';
import { UserService } from '../user/user.service';
import { AuthService } from './auth.service';
import { CreateMagicLinkDto } from './dto/create-magic-link.dto';
import { MagicLinkRepository } from './magic-link.repository';

const MAX_TOKENS_PER_USER = 5;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class MagicLinkService {
  private readonly logger = new Logger(MagicLinkService.name);

  constructor(
    private readonly magicLinkRepo: MagicLinkRepository,
    private readonly userService: UserService,
    private readonly authService: AuthService,
    private readonly auditEvents: AuditEventsService,
  ) {}

  async createToken(actor: RequestUser, dto: CreateMagicLinkDto) {
    if (!actor.isSuperuser) {
      throw new ForbiddenException('Only superusers can create magic links');
    }

    const targetUser = await this.userService.findById(dto.userId);
    if (targetUser.provisioningMethod !== 'shared') {
      throw new BadRequestException('Magic links can only be created for shared accounts');
    }

    const activeCount = await this.magicLinkRepo.countActiveByUserId(dto.userId);
    if (activeCount >= MAX_TOKENS_PER_USER) {
      throw new BadRequestException(`Maximum of ${MAX_TOKENS_PER_USER} active magic links per user`);
    }

    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
    if (expiresAt && expiresAt <= new Date()) {
      throw new BadRequestException('Expiry date must be in the future');
    }

    const result = await this.magicLinkRepo.create({
      userId: dto.userId,
      createdBy: actor.id,
      label: dto.label,
      expiresAt,
    });

    this.logger.log(
      `[magic_link.create] [end] tokenId=${result.id} userId=${dto.userId} createdBy=${actor.id} label="${dto.label}" - magic link created`,
    );

    this.auditEvents.emit(AUDIT_EVENT, {
      userId: actor.id,
      actorUsername: actor.username,
      action: AuditAction.MagicLinkCreate,
      resource: AuditResource.MagicLinkToken,
      resourceId: result.id,
      description: `Created magic link '${dto.label}' for user #${dto.userId}`,
    });

    return {
      id: result.id,
      token: result.rawToken,
      label: result.label,
      expiresAt: result.expiresAt?.toISOString() ?? null,
    };
  }

  async loginWithToken(rawToken: string, reply: FastifyReply, ip?: string) {
    const tokenHash = sha256(rawToken);
    const row = await this.magicLinkRepo.findByTokenHash(tokenHash);

    if (!row) {
      this.logger.warn('[magic_link.login] [fail] errorClass=UnauthorizedException error="token not found" - magic link login failed');
      throw new UnauthorizedException('Invalid or expired magic link');
    }

    if (row.revokedAt) {
      this.logger.warn(
        `[magic_link.login] [fail] tokenId=${row.id} userId=${row.userId} errorClass=UnauthorizedException error="token revoked" - magic link login failed`,
      );
      throw new UnauthorizedException('Invalid or expired magic link');
    }

    if (!row.isActive) {
      this.logger.warn(
        `[magic_link.login] [fail] tokenId=${row.id} userId=${row.userId} errorClass=UnauthorizedException error="token deactivated" - magic link login failed`,
      );
      throw new UnauthorizedException('Invalid or expired magic link');
    }

    if (row.expiresAt && row.expiresAt < new Date()) {
      this.logger.warn(
        `[magic_link.login] [fail] tokenId=${row.id} userId=${row.userId} errorClass=UnauthorizedException error="token expired" - magic link login failed`,
      );
      throw new UnauthorizedException('Invalid or expired magic link');
    }

    const user = await this.userService.findById(row.userId).catch(() => null);
    if (!user || !user.active) {
      this.logger.warn(
        `[magic_link.login] [fail] tokenId=${row.id} userId=${row.userId} errorClass=UnauthorizedException error="user inactive or not found" - magic link login failed`,
      );
      throw new UnauthorizedException('Invalid or expired magic link');
    }

    await this.magicLinkRepo.updateUsage(row.id);
    const result = await this.authService.issueTokensForUser(row.userId, reply);

    this.logger.log(`[magic_link.login] [end] tokenId=${row.id} userId=${row.userId} ip=${ip ?? 'unknown'} - magic link login completed`);

    this.auditEvents.emit(AUDIT_EVENT, {
      userId: row.userId,
      actorUsername: user.username,
      action: AuditAction.MagicLinkLogin,
      resource: AuditResource.MagicLinkToken,
      resourceId: row.id,
      description: `Magic link login for user '${user.username}' (link: '${row.label}')`,
      ip,
    });

    return result;
  }

  async listTokens() {
    return this.magicLinkRepo.findAll();
  }

  async setActive(actor: RequestUser, tokenId: number, isActive: boolean) {
    if (!actor.isSuperuser) {
      throw new ForbiddenException('Only superusers can manage magic links');
    }

    const existing = await this.magicLinkRepo.findById(tokenId);
    if (!existing) throw new NotFoundException('Magic link not found');
    if (existing.revokedAt) throw new BadRequestException('Cannot change a revoked magic link');

    const updated = await this.magicLinkRepo.setActive(tokenId, isActive);
    if (!updated) throw new NotFoundException('Magic link not found');

    if (!isActive) {
      await this.authService.revokeAllUserSessions(updated.userId);
      this.logger.log(`[magic_link.deactivate] [end] tokenId=${tokenId} userId=${updated.userId} deactivatedBy=${actor.id} - magic link deactivated`);

      this.auditEvents.emit(AUDIT_EVENT, {
        userId: actor.id,
        actorUsername: actor.username,
        action: AuditAction.MagicLinkDeactivate,
        resource: AuditResource.MagicLinkToken,
        resourceId: tokenId,
        description: `Deactivated magic link #${tokenId} for user #${updated.userId}`,
      });
    } else {
      this.logger.log(`[magic_link.activate] [end] tokenId=${tokenId} userId=${updated.userId} activatedBy=${actor.id} - magic link activated`);

      this.auditEvents.emit(AUDIT_EVENT, {
        userId: actor.id,
        actorUsername: actor.username,
        action: AuditAction.MagicLinkActivate,
        resource: AuditResource.MagicLinkToken,
        resourceId: tokenId,
        description: `Activated magic link #${tokenId} for user #${updated.userId}`,
      });
    }

    return { id: updated.id, isActive: updated.isActive };
  }

  async revokeToken(actor: RequestUser, tokenId: number) {
    if (!actor.isSuperuser) {
      throw new ForbiddenException('Only superusers can revoke magic links');
    }

    const existing = await this.magicLinkRepo.findById(tokenId);
    if (!existing) {
      throw new NotFoundException('Magic link not found');
    }
    if (existing.revokedAt) {
      throw new BadRequestException('Magic link is already revoked');
    }

    const revoked = await this.magicLinkRepo.revoke(tokenId);
    if (!revoked) {
      throw new NotFoundException('Magic link not found');
    }

    await this.authService.revokeAllUserSessions(revoked.userId);

    this.logger.log(`[magic_link.revoke] [end] tokenId=${tokenId} userId=${revoked.userId} revokedBy=${actor.id} - magic link revoked`);

    this.auditEvents.emit(AUDIT_EVENT, {
      userId: actor.id,
      actorUsername: actor.username,
      action: AuditAction.MagicLinkRevoke,
      resource: AuditResource.MagicLinkToken,
      resourceId: tokenId,
      description: `Revoked magic link #${tokenId} for user #${revoked.userId}`,
    });
  }
}
