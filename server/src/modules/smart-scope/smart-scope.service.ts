import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import type { BooksPage } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import type { SmartScope } from '../../db/schema/smart-scopes';
import { BookQueryBuilder } from '../book/book-query-builder.service';
import { BookReadService } from '../book/book-read.service';
import { validateGroupRule } from '../book/utils/group-rule.validator';
import { assembleBookCards } from '../book/utils/assemble-book-cards';
import { LibraryService } from '../library/library.service';
import { CreateSmartScopeDto } from './dto/create-smart-scope.dto';
import { ReorderSmartScopesDto } from './dto/reorder-smart-scopes.dto';
import { UpdateSmartScopeDto } from './dto/update-smart-scope.dto';
import { SmartScopeRepository } from './smart-scope.repository';

function normalizeIcon(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const icon = value.trim();
  return icon.length > 0 ? icon : null;
}

@Injectable()
export class SmartScopeService {
  constructor(
    private readonly smartScopeRepo: SmartScopeRepository,
    private readonly bookReadService: BookReadService,
    private readonly queryBuilder: BookQueryBuilder,
    private readonly libraryService: LibraryService,
  ) {}

  private async getSmartScopeOrThrow(id: number): Promise<SmartScope> {
    const [smartScope] = await this.smartScopeRepo.findById(id);
    if (!smartScope) {
      throw new NotFoundException('SmartScope not found');
    }
    return smartScope;
  }

  private assertReadAccess(smartScope: SmartScope, user: RequestUser): void {
    if (!smartScope.isPublic && smartScope.userId !== user.id && !user.isSuperuser) {
      throw new ForbiddenException('No access to this smartScope');
    }
  }

  private assertWriteAccess(smartScope: SmartScope, user: RequestUser, action: 'modify' | 'delete'): void {
    if (smartScope.userId !== user.id && !user.isSuperuser) {
      const message = action === 'modify' ? 'Cannot modify this smartScope' : 'Cannot delete this smartScope';
      throw new ForbiddenException(message);
    }
  }

  async findAll(user: RequestUser) {
    const smartScopes = await this.smartScopeRepo.findAllForUser(user.id);
    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    return Promise.all(
      smartScopes.map(async (smartScope) => {
        const where = this.queryBuilder.buildWhere(smartScope.filter, { accessibleLibraryIds, userId: user.id });
        const bookCount = await this.bookReadService.countWhere(where);
        return { ...smartScope, bookCount };
      }),
    );
  }

  async findOne(id: number, user: RequestUser) {
    const smartScope = await this.getSmartScopeOrThrow(id);
    this.assertReadAccess(smartScope, user);
    return smartScope;
  }

  async create(dto: CreateSmartScopeDto, user: RequestUser) {
    const filter = validateGroupRule(dto.filter);
    const icon = normalizeIcon(dto.icon);
    if (!icon) {
      throw new BadRequestException('Icon is required');
    }
    const [smartScope] = await this.smartScopeRepo.insert({
      userId: user.id,
      name: dto.name,
      icon,
      filter,
      defaultSort: dto.defaultSort ?? [],
      isPublic: dto.isPublic ?? false,
    });
    return smartScope;
  }

  async update(id: number, dto: UpdateSmartScopeDto, user: RequestUser) {
    const smartScope = await this.getSmartScopeOrThrow(id);
    this.assertWriteAccess(smartScope, user, 'modify');

    const hasFilterField = Object.prototype.hasOwnProperty.call(dto, 'filter');
    const filter = hasFilterField ? validateGroupRule(dto.filter) : undefined;
    const icon = dto.icon !== undefined ? normalizeIcon(dto.icon) : normalizeIcon(smartScope.icon);
    if (!icon) {
      throw new BadRequestException('Icon is required');
    }
    const [updated] = await this.smartScopeRepo.update(id, smartScope.userId, {
      name: dto.name,
      icon: dto.icon !== undefined ? icon : undefined,
      filter,
      defaultSort: dto.defaultSort,
      isPublic: dto.isPublic,
    });
    return updated;
  }

  async remove(id: number, user: RequestUser) {
    const smartScope = await this.getSmartScopeOrThrow(id);
    this.assertWriteAccess(smartScope, user, 'delete');
    await this.smartScopeRepo.delete(id, smartScope.userId);
  }

  async reorder(dto: ReorderSmartScopesDto, user: RequestUser) {
    const distinctIds = new Set(dto.order.map((item) => item.id));
    if (distinctIds.size !== dto.order.length) {
      throw new BadRequestException('Duplicate smartScope IDs are not allowed in reorder payload');
    }

    const updatedCount = await this.smartScopeRepo.updateDisplayOrders(user.id, dto.order);
    if (updatedCount !== dto.order.length) {
      throw new ForbiddenException('Cannot reorder one or more smartScopes');
    }
  }

  async executeSmartScope(id: number, user: RequestUser, page: number, size: number, q?: string): Promise<BooksPage> {
    const smartScope = await this.getSmartScopeOrThrow(id);
    this.assertReadAccess(smartScope, user);
    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);

    const where = this.queryBuilder.buildWhere(smartScope.filter, { accessibleLibraryIds, userId: user.id, q });
    const orderBy = this.queryBuilder.buildOrderBy(smartScope.defaultSort ?? [], user.id);
    const { rows, authorRows, fileRows, genreRows, progressRows, total } = await this.bookReadService.findCards({
      where,
      orderBy,
      limit: size,
      offset: page * size,
      userId: user.id,
    });

    return { items: assembleBookCards(rows, authorRows, fileRows, genreRows, progressRows), total, page, size };
  }
}
