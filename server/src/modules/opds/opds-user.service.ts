import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
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
  constructor(@Inject(DB) private readonly db: Db) {}

  findAllForUser(userId: number) {
    return this.db
      .select({
        id: schema.opdsUsers.id,
        userId: schema.opdsUsers.userId,
        username: schema.opdsUsers.username,
        sortOrder: schema.opdsUsers.sortOrder,
        createdAt: schema.opdsUsers.createdAt,
      })
      .from(schema.opdsUsers)
      .where(eq(schema.opdsUsers.userId, userId))
      .orderBy(schema.opdsUsers.username);
  }

  async create(userId: number, dto: CreateOpdsUserDto) {
    const passwordHash = await hash(dto.password, 12);
    try {
      const [created] = await this.db
        .insert(schema.opdsUsers)
        .values({
          userId,
          username: dto.username,
          passwordHash,
          sortOrder: dto.sortOrder ?? 'recent',
        })
        .returning({
          id: schema.opdsUsers.id,
          userId: schema.opdsUsers.userId,
          username: schema.opdsUsers.username,
          sortOrder: schema.opdsUsers.sortOrder,
          createdAt: schema.opdsUsers.createdAt,
        });
      return created;
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('An OPDS user with this username already exists');
      }
      throw err;
    }
  }

  async update(userId: number, opdsUserId: number, dto: UpdateOpdsUserDto) {
    await this.verifyOwnership(userId, opdsUserId);
    const [updated] = await this.db.update(schema.opdsUsers).set({ sortOrder: dto.sortOrder }).where(eq(schema.opdsUsers.id, opdsUserId)).returning({
      id: schema.opdsUsers.id,
      userId: schema.opdsUsers.userId,
      username: schema.opdsUsers.username,
      sortOrder: schema.opdsUsers.sortOrder,
      createdAt: schema.opdsUsers.createdAt,
    });
    if (!updated) throw new NotFoundException('OPDS user not found');
    return updated;
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
