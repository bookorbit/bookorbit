import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';
import { AuditAction, AuditResource, Permission, type ApiKeySummary, type CreatedApiKey } from '@bookorbit/types';

import { InteractiveOnly } from '../../common/decorators/api-key-policy.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { createdKeyId, createdKeyMeta, keyIdParam } from './api-key-audit';
import { ApiKeyService } from './api-key.service';
import { CreateApiKeyDto } from './dto/api-key.dto';

/** An administrator managing another user's keys. The key belongs to that user and runs as them. */
@Controller('users/:id/api-keys')
@InteractiveOnly()
@RequirePermission(Permission.ManageUsers)
export class UserApiKeyController {
  constructor(private readonly apiKeys: ApiKeyService) {}

  @Get()
  async list(@CurrentUser() actor: RequestUser, @Param('id', ParseIntPipe) userId: number): Promise<ApiKeySummary[]> {
    await this.apiKeys.assertCanManageKeysOf(actor, userId);
    return this.apiKeys.list(userId);
  }

  @Post()
  @Auditable({
    action: AuditAction.ApiKeyCreate,
    resource: AuditResource.ApiKey,
    getResourceId: createdKeyId,
    getMeta: (req, body) => ({ ...createdKeyMeta(req, body), ownerId: parseInt(req.params['id'] ?? '', 10) }),
    description: (req, body) => `Issued API key '${(body as CreatedApiKey).key.name}' for user #${req.params['id']}`,
  })
  async create(@CurrentUser() actor: RequestUser, @Param('id', ParseIntPipe) userId: number, @Body() dto: CreateApiKeyDto): Promise<CreatedApiKey> {
    await this.apiKeys.assertCanManageKeysOf(actor, userId);
    return this.apiKeys.create(userId, dto, actor);
  }

  @Delete(':keyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    action: AuditAction.ApiKeyRevoke,
    resource: AuditResource.ApiKey,
    getResourceId: keyIdParam,
    getMeta: (req) => ({ ownerId: parseInt(req.params['id'] ?? '', 10) }),
    description: (req) => `Revoked an API key of user #${req.params['id']}`,
  })
  async revoke(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseIntPipe) userId: number,
    @Param('keyId', ParseIntPipe) keyId: number,
  ): Promise<void> {
    await this.apiKeys.assertCanManageKeysOf(actor, userId);
    await this.apiKeys.revoke(userId, keyId);
  }

  @Delete()
  @Auditable({
    action: AuditAction.ApiKeyRevokeAll,
    resource: AuditResource.User,
    getResourceId: (req) => parseInt(req.params['id'] ?? '', 10),
    getMeta: (_req, body) => ({ revoked: (body as { revoked: number }).revoked }),
    description: (req, body) => `Revoked all API keys of user #${req.params['id']} (${(body as { revoked: number }).revoked})`,
  })
  async revokeAll(@CurrentUser() actor: RequestUser, @Param('id', ParseIntPipe) userId: number): Promise<{ revoked: number }> {
    await this.apiKeys.assertCanManageKeysOf(actor, userId);
    return this.apiKeys.revokeAll(userId);
  }
}
