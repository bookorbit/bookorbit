import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import type { BooksPage } from '@projectx/types';
import type { RequestUser } from '../../common/types/request-user';
import type { Lens } from '../../db/schema/lenses';
import { BookQueryBuilder } from '../book/book-query-builder.service';
import { BookReadService } from '../book/book-read.service';
import { validateGroupRule } from '../book/utils/group-rule.validator';
import { assembleBookCards } from '../book/utils/assemble-book-cards';
import { LibraryService } from '../library/library.service';
import { CreateLensDto } from './dto/create-lens.dto';
import { ReorderLensesDto } from './dto/reorder-lenses.dto';
import { UpdateLensDto } from './dto/update-lens.dto';
import { LensRepository } from './lens.repository';

@Injectable()
export class LensService {
  constructor(
    private readonly lensRepo: LensRepository,
    private readonly bookReadService: BookReadService,
    private readonly queryBuilder: BookQueryBuilder,
    private readonly libraryService: LibraryService,
  ) {}

  private async getLensOrThrow(id: number): Promise<Lens> {
    const [lens] = await this.lensRepo.findById(id);
    if (!lens) {
      throw new NotFoundException('Lens not found');
    }
    return lens;
  }

  private assertReadAccess(lens: Lens, user: RequestUser): void {
    if (!lens.isPublic && lens.userId !== user.id && !user.isSuperuser) {
      throw new ForbiddenException('No access to this lens');
    }
  }

  private assertWriteAccess(lens: Lens, user: RequestUser, action: 'modify' | 'delete'): void {
    if (lens.userId !== user.id && !user.isSuperuser) {
      const message = action === 'modify' ? 'Cannot modify this lens' : 'Cannot delete this lens';
      throw new ForbiddenException(message);
    }
  }

  async findAll(user: RequestUser) {
    const lenses = await this.lensRepo.findAllForUser(user.id);
    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    return Promise.all(
      lenses.map(async (lens) => {
        const where = this.queryBuilder.buildWhere(lens.filter, { accessibleLibraryIds, userId: user.id });
        const bookCount = await this.bookReadService.countWhere(where);
        return { ...lens, bookCount };
      }),
    );
  }

  async findOne(id: number, user: RequestUser) {
    const lens = await this.getLensOrThrow(id);
    this.assertReadAccess(lens, user);
    return lens;
  }

  async create(dto: CreateLensDto, user: RequestUser) {
    const filter = validateGroupRule(dto.filter);
    const [lens] = await this.lensRepo.insert({
      userId: user.id,
      name: dto.name,
      icon: dto.icon ?? null,
      filter,
      defaultSort: dto.defaultSort ?? [],
      isPublic: dto.isPublic ?? false,
    });
    return lens;
  }

  async update(id: number, dto: UpdateLensDto, user: RequestUser) {
    const lens = await this.getLensOrThrow(id);
    this.assertWriteAccess(lens, user, 'modify');

    const hasFilterField = Object.prototype.hasOwnProperty.call(dto, 'filter');
    const filter = hasFilterField ? validateGroupRule(dto.filter) : undefined;
    const [updated] = await this.lensRepo.update(id, lens.userId, {
      name: dto.name,
      icon: dto.icon,
      filter,
      defaultSort: dto.defaultSort,
      isPublic: dto.isPublic,
    });
    return updated;
  }

  async remove(id: number, user: RequestUser) {
    const lens = await this.getLensOrThrow(id);
    this.assertWriteAccess(lens, user, 'delete');
    await this.lensRepo.delete(id, lens.userId);
  }

  async reorder(dto: ReorderLensesDto, user: RequestUser) {
    const distinctIds = new Set(dto.order.map((item) => item.id));
    if (distinctIds.size !== dto.order.length) {
      throw new BadRequestException('Duplicate lens IDs are not allowed in reorder payload');
    }

    const updatedCount = await this.lensRepo.updateDisplayOrders(user.id, dto.order);
    if (updatedCount !== dto.order.length) {
      throw new ForbiddenException('Cannot reorder one or more lenses');
    }
  }

  async executeLens(id: number, user: RequestUser, page: number, size: number): Promise<BooksPage> {
    const lens = await this.getLensOrThrow(id);
    this.assertReadAccess(lens, user);
    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);

    const where = this.queryBuilder.buildWhere(lens.filter, { accessibleLibraryIds, userId: user.id });
    const orderBy = this.queryBuilder.buildOrderBy(lens.defaultSort ?? [], user.id);
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
