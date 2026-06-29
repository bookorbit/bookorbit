import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import { AuditAction, type EntityType, INLINE_ENTITY_TYPES, Permission } from '@bookorbit/types';
import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import {
  BrowseEntitiesDto,
  BulkDeleteEntitiesDto,
  DeleteEntityDto,
  DismissPairDto,
  MergeEntitiesDto,
  RefreshDuplicatesDto,
  RenameEntityDto,
  ScanDuplicatesDto,
  SplitEntityDto,
  UndismissPairDto,
} from './dto/entity-manager.dto';
import { EntityManagerService } from './entity-manager.service';
import { EntityTypePipe } from './entity-type.pipe';

function isInline(entityType: string): boolean {
  return INLINE_ENTITY_TYPES.includes(entityType as any);
}

@Controller('entity-manager')
export class EntityManagerController {
  constructor(private readonly service: EntityManagerService) {}

  @Get(':entityType/browse')
  @RequirePermission(Permission.LibraryEditMetadata)
  browse(@Param('entityType', EntityTypePipe) entityType: EntityType, @Query() dto: BrowseEntitiesDto, @CurrentUser() user: RequestUser) {
    return this.service.browse(entityType, user, dto);
  }

  @Get(':entityType/duplicates/scan')
  @RequirePermission(Permission.LibraryEditMetadata)
  scanDuplicates(@Param('entityType', EntityTypePipe) entityType: EntityType, @Query() dto: ScanDuplicatesDto, @CurrentUser() user: RequestUser) {
    return this.service.scanDuplicates(entityType, user, dto.libraryId, dto.minSimilarity, dto.page, dto.pageSize);
  }

  @Get(':entityType/duplicates/status')
  @RequirePermission(Permission.LibraryEditMetadata)
  getDuplicateScanStatus(@Param('entityType', EntityTypePipe) entityType: EntityType) {
    return this.service.getDuplicateScanStatus(entityType);
  }

  @Post(':entityType/duplicates/refresh')
  @RequirePermission(Permission.LibraryEditMetadata)
  refreshDuplicates(@Param('entityType', EntityTypePipe) entityType: EntityType, @Body() dto: RefreshDuplicatesDto) {
    return this.service.refreshDuplicates(entityType, dto.minSimilarity);
  }

  @Post(':entityType/merge')
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.EntityManagerMerge,
    description: (req) => `Merged ${req.params?.entityType} entities into target`,
  })
  merge(@Param('entityType', EntityTypePipe) entityType: EntityType, @Body() dto: MergeEntitiesDto, @CurrentUser() user: RequestUser) {
    const inline = isInline(entityType);
    const targetId = inline ? dto.targetValue! : dto.targetEntityId!;
    const sourceIds = inline ? dto.sourceValues! : dto.sourceEntityIds!;
    return this.service.merge(entityType, user, targetId, sourceIds, dto.writeFiles ?? false);
  }

  @Post(':entityType/rename')
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.EntityManagerRename,
    getResourceId: (req) => (req.body as Record<string, unknown>)?.entityId as number | undefined,
    description: (req) => `Renamed ${req.params?.entityType} to "${String((req.body as Record<string, unknown>)?.newName)}"`,
  })
  rename(@Param('entityType', EntityTypePipe) entityType: EntityType, @Body() dto: RenameEntityDto, @CurrentUser() user: RequestUser) {
    const entityId = isInline(entityType) ? dto.currentValue! : dto.entityId!;
    return this.service.rename(entityType, user, entityId, dto.newName, dto.writeFiles ?? false);
  }

  @Post(':entityType/delete')
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.EntityManagerDelete,
    getResourceId: (req) => (req.body as Record<string, unknown>)?.entityId as number | undefined,
    description: (req) => `Deleted ${req.params?.entityType}`,
  })
  deleteEntity(@Param('entityType', EntityTypePipe) entityType: EntityType, @Body() dto: DeleteEntityDto, @CurrentUser() user: RequestUser) {
    const entityId = isInline(entityType) ? dto.value! : dto.entityId!;
    const mode = isInline(entityType) ? 'inline' : (dto.mode ?? 'hard');
    return this.service.deleteEntity(entityType, user, entityId, mode as 'soft' | 'hard' | 'inline', dto.writeFiles ?? false);
  }

  @Post(':entityType/bulk-delete')
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.EntityManagerDelete,
    description: (req) => {
      const body = req.body as Record<string, unknown>;
      const count = ((body.entityIds as unknown[]) ?? (body.values as unknown[]) ?? []).length;
      return `Bulk deleted ${count} ${req.params?.entityType} entities`;
    },
  })
  bulkDelete(@Param('entityType', EntityTypePipe) entityType: EntityType, @Body() dto: BulkDeleteEntitiesDto, @CurrentUser() user: RequestUser) {
    const entityIds = isInline(entityType) ? dto.values! : dto.entityIds!;
    const mode = isInline(entityType) ? 'inline' : (dto.mode ?? 'hard');
    return this.service.bulkDelete(entityType, user, entityIds, mode as 'soft' | 'hard' | 'inline', dto.writeFiles ?? false);
  }

  @Post(':entityType/split')
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.EntityManagerSplit,
    getResourceId: (req) => (req.body as Record<string, unknown>)?.entityId as number | undefined,
    description: (req) =>
      `Split ${req.params?.entityType} into ${(((req.body as Record<string, unknown>)?.newNames as string[]) ?? []).length} entities`,
  })
  split(@Param('entityType', EntityTypePipe) entityType: EntityType, @Body() dto: SplitEntityDto, @CurrentUser() user: RequestUser) {
    return this.service.split(entityType, user, dto.entityId, dto.newNames, dto.writeFiles ?? false);
  }

  @Post(':entityType/duplicates/dismiss')
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.EntityManagerDismiss,
    description: (req) => `Dismissed ${req.params?.entityType} duplicate pair`,
  })
  dismissPair(@Param('entityType', EntityTypePipe) entityType: EntityType, @Body() dto: DismissPairDto, @CurrentUser() user: RequestUser) {
    const idA = isInline(entityType) ? dto.valueA! : dto.entityIdA!;
    const idB = isInline(entityType) ? dto.valueB! : dto.entityIdB!;
    return this.service.dismissPair(entityType, user, idA, idB, dto.reason);
  }

  @Post(':entityType/duplicates/undismiss')
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.EntityManagerUndismiss,
    description: (req) => `Undismissed ${req.params?.entityType} duplicate pair`,
  })
  undismissPair(@Param('entityType', EntityTypePipe) entityType: EntityType, @Body() dto: UndismissPairDto, @CurrentUser() user: RequestUser) {
    const idA = isInline(entityType) ? dto.valueA! : dto.entityIdA!;
    const idB = isInline(entityType) ? dto.valueB! : dto.entityIdB!;
    return this.service.undismissPair(entityType, user, idA, idB);
  }

  @Get(':entityType/duplicates/dismissed')
  @RequirePermission(Permission.LibraryEditMetadata)
  getDismissedPairs(@Param('entityType', EntityTypePipe) entityType: EntityType, @CurrentUser() user: RequestUser) {
    return this.service.getDismissedPairs(entityType, user);
  }

  @Get(':entityType/info/:entityId')
  @RequirePermission(Permission.LibraryEditMetadata)
  getEntityInfo(@Param('entityType', EntityTypePipe) entityType: EntityType, @Param('entityId') entityId: string) {
    const parsedId = isInline(entityType) ? entityId : Number(entityId);
    return this.service.getEntityInfo(entityType, parsedId);
  }
}
