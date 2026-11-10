import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { AuditAction, AuditResource, Permission, type ApiKeySettings, type ApiKeySummary, type CreatedApiKey } from '@bookorbit/types';

import { InteractiveOnly } from '../../common/decorators/api-key-policy.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { createdKeyId, createdKeyMeta, keyIdParam } from './api-key-audit';
import { ApiKeyService } from './api-key.service';
import { CreateApiKeyDto, RenameApiKeyDto } from './dto/api-key.dto';

/** The signed-in user's own keys. Listing and revoking stay open to an owner who lost `api_keys`. */
@Controller('api-keys')
@InteractiveOnly()
export class ApiKeyController {
  constructor(private readonly apiKeys: ApiKeyService) {}

  @Get()
  list(@CurrentUser() user: RequestUser): Promise<ApiKeySummary[]> {
    return this.apiKeys.list(user.id);
  }

  @Get('settings')
  settings(): Promise<ApiKeySettings> {
    return this.apiKeys.getSettings();
  }

  @Post()
  @RequirePermission(Permission.ApiKeys)
  @Auditable({
    action: AuditAction.ApiKeyCreate,
    resource: AuditResource.ApiKey,
    getResourceId: createdKeyId,
    getMeta: createdKeyMeta,
    description: (_req, body) => `Created API key '${(body as CreatedApiKey).key.name}'`,
  })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateApiKeyDto): Promise<CreatedApiKey> {
    return this.apiKeys.create(user.id, dto);
  }

  @Patch(':id')
  @Auditable({
    action: AuditAction.ApiKeyRename,
    resource: AuditResource.ApiKey,
    getResourceId: keyIdParam,
    description: (_req, body) => `Renamed API key to '${(body as ApiKeySummary).name}'`,
  })
  rename(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number, @Body() dto: RenameApiKeyDto): Promise<ApiKeySummary> {
    return this.apiKeys.rename(user.id, id, dto.name);
  }

  @Post(':id/regenerate')
  @RequirePermission(Permission.ApiKeys)
  @Auditable({
    action: AuditAction.ApiKeyRegenerate,
    resource: AuditResource.ApiKey,
    getResourceId: createdKeyId,
    getMeta: (req, body) => ({ ...createdKeyMeta(req, body), replacedKeyId: keyIdParam(req) }),
    description: (_req, body) => `Regenerated API key '${(body as CreatedApiKey).key.name}'`,
  })
  regenerate(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number): Promise<CreatedApiKey> {
    return this.apiKeys.regenerate(user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    action: AuditAction.ApiKeyRevoke,
    resource: AuditResource.ApiKey,
    getResourceId: keyIdParam,
    description: 'Revoked an API key',
  })
  async revoke(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.apiKeys.revoke(user.id, id);
  }

  @Delete()
  @Auditable({
    action: AuditAction.ApiKeyRevokeAll,
    resource: AuditResource.User,
    getResourceId: (req) => (req as unknown as { user?: RequestUser }).user?.id,
    getMeta: (_req, body) => ({ revoked: (body as { revoked: number }).revoked }),
    description: (_req, body) => `Revoked all API keys (${(body as { revoked: number }).revoked})`,
  })
  revokeAll(@CurrentUser() user: RequestUser): Promise<{ revoked: number }> {
    return this.apiKeys.revokeAll(user.id);
  }
}
