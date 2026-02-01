import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { basename } from 'path';

import type { BookCard, BooksPage, GroupRule, SortSpec } from '@projectx/types';
import type { RequestUser } from '../../common/types/request-user';
import { BookQueryBuilder } from '../book/book-query-builder.service';
import { BookRepository } from '../book/book.repository';
import { validateGroupRule } from '../book/utils/group-rule.validator';
import { LibraryService } from '../library/library.service';
import { CreateLensDto } from './dto/create-lens.dto';
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
    return user.roles.some((r) => r.isSuperuser);
  }

  private assembleBookCards(
    rows: { id: number; status: string; folderPath: string; title: string | null; seriesName: string | null; seriesIndex: number | null }[],
    authorRows: { bookId: number; name: string }[],
    fileRows: { bookId: number; id: number; format: string | null; role: string }[],
  ): BookCard[] {
    const authorsByBook = new Map<number, string[]>();
    for (const row of authorRows) {
      const list = authorsByBook.get(row.bookId) ?? [];
      list.push(row.name);
      authorsByBook.set(row.bookId, list);
    }

    const filesByBook = new Map<number, { id: number; format: string | null; role: string }[]>();
    for (const row of fileRows) {
      const list = filesByBook.get(row.bookId) ?? [];
      list.push({ id: row.id, format: row.format, role: row.role });
      filesByBook.set(row.bookId, list);
    }

    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      title: row.title ?? basename(row.folderPath),
      seriesName: row.seriesName ?? null,
      seriesIndex: row.seriesIndex ?? null,
      authors: authorsByBook.get(row.id) ?? [],
      files: filesByBook.get(row.id) ?? [],
    }));
  }

  async findAll(user: RequestUser) {
    const lenses = await this.lensRepo.findAllForUser(user.id);
    const libs = await this.libraryService.findAll(user);
    const accessibleLibraryIds = libs.map((l) => l.id);
    return Promise.all(
      lenses.map(async (lens) => {
        const where = this.queryBuilder.buildWhere(lens.filter as GroupRule | null, { accessibleLibraryIds });
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

  async executeLens(id: number, user: RequestUser, page: number, size: number): Promise<BooksPage> {
    const [lens] = await this.lensRepo.findById(id);
    if (!lens) throw new NotFoundException('Lens not found');
    if (!lens.isPublic && lens.userId !== user.id && !this.isSuperuser(user)) {
      throw new ForbiddenException('No access to this lens');
    }

    const libs = await this.libraryService.findAll(user);
    const accessibleLibraryIds = libs.map((l) => l.id);

    const where = this.queryBuilder.buildWhere(lens.filter as GroupRule | null, { accessibleLibraryIds });
    const orderBy = this.queryBuilder.buildOrderBy((lens.defaultSort as SortSpec[]) ?? []);
    const { rows, authorRows, fileRows, total } = await this.bookRepo.findCards({
      where,
      orderBy,
      limit: size,
      offset: page * size,
    });

    return { items: this.assembleBookCards(rows, authorRows, fileRows), total, page, size };
  }
}
