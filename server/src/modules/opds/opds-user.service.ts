import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OPDS_DEFAULT_PAGE_SIZE } from '@bookorbit/types';
import { compare, hash } from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { CreateOpdsUserDto } from './dto/create-opds-user.dto';
import { UpdateOpdsUserDto } from './dto/update-opds-user.dto';

type Db = NodePgDatabase<typeof schema>;

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const directCode = (error as { code?: unknown }).code;
  if (directCode === '23505') return true;

  if (!(error instanceof Error)) return false;
  const causeCode = (error.cause as { code?: unknown } | undefined)?.code;
  return causeCode === '23505';
}

@Injectable()
export class OpdsUserService {
  private readonly logger = new Logger(OpdsUserService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  findAllForUser(userId: number) {
    return this.db
      .select({
        id: schema.opdsUsers.id,
        userId: schema.opdsUsers.userId,
        username: schema.opdsUsers.username,
        sortOrder: schema.opdsUsers.sortOrder,
        pageSize: schema.opdsUsers.pageSize,
        createdAt: schema.opdsUsers.createdAt,
      })
      .from(schema.opdsUsers)
      .where(eq(schema.opdsUsers.userId, userId))
      .orderBy(schema.opdsUsers.username);
  }

  async create(userId: number, dto: CreateOpdsUserDto) {
    const startedAt = Date.now();
    const sortOrder = dto.sortOrder ?? 'recent';
    const pageSize = dto.pageSize ?? OPDS_DEFAULT_PAGE_SIZE;
    this.logger.log(
      `[opds.user.create] [start] userId=${userId} sortOrder="${sanitizeLogValue(sortOrder)}" pageSize=${pageSize} - OPDS user creation started`,
    );

    try {
      const passwordHash = await hash(dto.password, 12);
      const [created] = await this.db
        .insert(schema.opdsUsers)
        .values({
          userId,
          username: dto.username,
          passwordHash,
          sortOrder,
          pageSize,
        })
        .returning({
          id: schema.opdsUsers.id,
          userId: schema.opdsUsers.userId,
          username: schema.opdsUsers.username,
          sortOrder: schema.opdsUsers.sortOrder,
          pageSize: schema.opdsUsers.pageSize,
          createdAt: schema.opdsUsers.createdAt,
        });
      if (!created) throw new InternalServerErrorException('Failed to create OPDS user');

      this.logger.log(
        `[opds.user.create] [end] userId=${userId} opdsUserId=${created.id} sortOrder="${sanitizeLogValue(created.sortOrder)}" pageSize=${created.pageSize} durationMs=${Date.now() - startedAt} - OPDS user creation completed`,
      );
      return created;
    } catch (err: unknown) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[opds.user.create] [fail] userId=${userId} sortOrder="${sanitizeLogValue(sortOrder)}" pageSize=${pageSize} durationMs=${Date.now() - startedAt} errorClass=${sanitizeLogValue(errorClass)} error="${sanitizeLogValue(errorMessage)}" - OPDS user creation failed`,
      );
      if (isUniqueViolation(err)) {
        throw new ConflictException('An OPDS user with this username already exists');
      }
      throw err;
    }
  }

  async update(userId: number, opdsUserId: number, dto: UpdateOpdsUserDto) {
    const startedAt = Date.now();
    const requestedSortOrder = dto.sortOrder ?? 'unchanged';
    const requestedPageSize = dto.pageSize ?? 'unchanged';
    this.logger.log(
      `[opds.user.update] [start] userId=${userId} opdsUserId=${opdsUserId} sortOrder="${sanitizeLogValue(requestedSortOrder)}" pageSize=${requestedPageSize} - OPDS user update started`,
    );

    try {
      await this.verifyOwnership(userId, opdsUserId);
      if (dto.sortOrder === undefined && dto.pageSize === undefined) {
        throw new BadRequestException('At least one OPDS setting is required');
      }

      const [updated] = await this.db
        .update(schema.opdsUsers)
        .set({
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.pageSize !== undefined ? { pageSize: dto.pageSize } : {}),
        })
        .where(eq(schema.opdsUsers.id, opdsUserId))
        .returning({
          id: schema.opdsUsers.id,
          userId: schema.opdsUsers.userId,
          username: schema.opdsUsers.username,
          sortOrder: schema.opdsUsers.sortOrder,
          pageSize: schema.opdsUsers.pageSize,
          createdAt: schema.opdsUsers.createdAt,
        });
      if (!updated) throw new NotFoundException('OPDS user not found');

      this.logger.log(
        `[opds.user.update] [end] userId=${userId} opdsUserId=${updated.id} sortOrder="${sanitizeLogValue(updated.sortOrder)}" pageSize=${updated.pageSize} durationMs=${Date.now() - startedAt} - OPDS user update completed`,
      );
      return updated;
    } catch (err: unknown) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[opds.user.update] [fail] userId=${userId} opdsUserId=${opdsUserId} sortOrder="${sanitizeLogValue(requestedSortOrder)}" pageSize=${requestedPageSize} durationMs=${Date.now() - startedAt} errorClass=${sanitizeLogValue(errorClass)} error="${sanitizeLogValue(errorMessage)}" - OPDS user update failed`,
      );
      throw err;
    }
  }

  async delete(userId: number, opdsUserId: number) {
    await this.verifyOwnership(userId, opdsUserId);
    await this.db.delete(schema.opdsUsers).where(eq(schema.opdsUsers.id, opdsUserId));
  }

  async validateCredentials(username: string, password: string) {
    const opdsUser = await this.db.query.opdsUsers.findFirst({
      where: eq(schema.opdsUsers.username, username),
    });
    if (!opdsUser) return null;

    const valid = await compare(password, opdsUser.passwordHash);
    if (!valid) return null;

    const parentUser = await this.db.query.users.findFirst({
      where: eq(schema.users.id, opdsUser.userId),
    });
    if (!parentUser) return null;

    return { opdsUser, parentUser };
  }

  private async verifyOwnership(userId: number, opdsUserId: number) {
    const row = await this.db.query.opdsUsers.findFirst({
      where: and(eq(schema.opdsUsers.id, opdsUserId), eq(schema.opdsUsers.userId, userId)),
    });
    if (!row) throw new ForbiddenException('Not the owner of this OPDS user');
  }
}
