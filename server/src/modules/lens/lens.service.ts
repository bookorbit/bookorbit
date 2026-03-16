import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import type { BooksPage, GroupRule, SortSpec } from '@projectx/types';
import { assembleBookCards } from '../book/utils/assemble-book-cards';
import type { RequestUser } from '../../common/types/request-user';
import { BookQueryBuilder } from '../book/book-query-builder.service';
import { BookRepository } from '../book/book.repository';
import { validateGroupRule } from '../book/utils/group-rule.validator';
import { LibraryService } from '../library/library.service';
import { CreateLensDto } from './dto/create-lens.dto';
import { ReorderLensesDto } from './dto/reorder-lenses.dto';
import { UpdateLensDto } from './dto/update-lens.dto';
import { LensRepository } from './lens.repository';

@Injectable()
export class LensService {
  constructor(
    private readonly lensRepo: LensRepository,
    private readonly bookRepo: BookRepository,
    private readonly queryBuilder: BookQueryBuilder,
    private readonly libraryService: LibraryService,
  ) {}

  private isSuperuser(user: RequestUser): boolean {
    return user.isSuperuser;
  }

  async findAll(user: RequestUser) {
    const lenses = await this.lensRepo.findAllForUser(user.id);
    const libs = await this.libraryService.findAll(user);
    const accessibleLibraryIds = (libs as { id: number }[]).map((l) => l.id);
    return Promise.all(
      lenses.map(async (lens) => {
        const where = this.queryBuilder.buildWhere(lens.filter as GroupRule | null, { accessibleLibraryIds, userId: user.id });
        const bookCount = await this.bookRepo.countWhere(where);
        return { ...lens, bookCount };
      }),
    );
  }

  async findOne(id: number, user: RequestUser) {
    const [lens] = await this.lensRepo.findById(id);
    if (!lens) throw new NotFoundException('Lens not found');
    if (!lens.isPublic && lens.userId !== user.id && !this.isSuperuser(user)) {
      throw new ForbiddenException('No access to this lens');
    }
    return lens;
  }

  async create(dto: CreateLensDto, user: RequestUser) {
    const filter = validateGroupRule(dto.filter);
    const [lens] = await this.lensRepo.insert({
      userId: user.id,
      name: dto.name,
      icon: dto.icon ?? null,
      filter,
      defaultSort: (dto.defaultSort as SortSpec[]) ?? [],
      isPublic: dto.isPublic ?? false,
    });
    return lens;
  }

  async update(id: number, dto: UpdateLensDto, user: RequestUser) {
    const [lens] = await this.lensRepo.findById(id);
    if (!lens) throw new NotFoundException('Lens not found');
    if (lens.userId !== user.id && !this.isSuperuser(user)) throw new ForbiddenException('Cannot modify this lens');

    const filter = validateGroupRule(dto.filter);
    const [updated] = await this.lensRepo.update(id, lens.userId, {
      name: dto.name,
      icon: dto.icon,
      filter: filter ?? undefined,
      defaultSort: dto.defaultSort as SortSpec[] | undefined,
      isPublic: dto.isPublic,
    });
    return updated;
  }

  async remove(id: number, user: RequestUser) {
    const [lens] = await this.lensRepo.findById(id);
    if (!lens) throw new NotFoundException('Lens not found');
    if (lens.userId !== user.id && !this.isSuperuser(user)) throw new ForbiddenException('Cannot delete this lens');

    await this.lensRepo.delete(id, lens.userId);
  }

  async reorder(dto: ReorderLensesDto, user: RequestUser) {
    await this.lensRepo.updateDisplayOrders(user.id, dto.order);
  }

  async executeLens(id: number, user: RequestUser, page: number, size: number): Promise<BooksPage> {
    const [lens] = await this.lensRepo.findById(id);
    if (!lens) throw new NotFoundException('Lens not found');
    if (!lens.isPublic && lens.userId !== user.id && !this.isSuperuser(user)) {
      throw new ForbiddenException('No access to this lens');
    }

    const libs = await this.libraryService.findAll(user);
    const accessibleLibraryIds = (libs as { id: number }[]).map((l) => l.id);

    const where = this.queryBuilder.buildWhere(lens.filter as GroupRule | null, { accessibleLibraryIds, userId: user.id });
    const orderBy = this.queryBuilder.buildOrderBy((lens.defaultSort as SortSpec[]) ?? []);
    const { rows, authorRows, fileRows, genreRows, tagRows, progressRows, total } = await this.bookRepo.findCards({
      where,
      orderBy,
      limit: size,
      offset: page * size,
      userId: user.id,
    });

    return { items: assembleBookCards(rows, authorRows, fileRows, genreRows, tagRows, progressRows), total, page, size };
  }
}
