import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuditAction, AuditResource } from '@bookorbit/types';

import { AuditActorQueryDto, AuditLogQueryDto } from './audit-log-query.dto';

describe('AuditLogQueryDto', () => {
  it('transforms numeric query strings and validates enums/date strings', async () => {
    const dto = plainToInstance(AuditLogQueryDto, {
      userId: '11',
      search: 'Dune',
      actorUsername: 'reader',
      action: Object.values(AuditAction)[0],
      resource: Object.values(AuditResource)[0],
      dateFrom: '2026-01-01T00:00:00.000Z',
      dateTo: '2026-01-31T23:59:59.000Z',
      page: '2',
      pageSize: '75',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.userId).toBe(11);
    expect(dto.page).toBe(2);
    expect(dto.pageSize).toBe(75);
  });

  it('keeps default pagination values when omitted', async () => {
    const dto = plainToInstance(AuditLogQueryDto, {});
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(50);
  });

  it('rejects invalid bounds and malformed values', async () => {
    expect((await validate(plainToInstance(AuditLogQueryDto, { userId: '0' }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(AuditLogQueryDto, { page: '0' }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(AuditLogQueryDto, { pageSize: '500' }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(AuditLogQueryDto, { action: 'not.valid' }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(AuditLogQueryDto, { dateFrom: 'not-a-date' }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(AuditLogQueryDto, { search: 'x'.repeat(201) }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(AuditLogQueryDto, { actorUsername: 'x'.repeat(256) }))).length).toBeGreaterThan(0);
  });

  it('validates actor lookup queries and applies the default limit', async () => {
    const defaults = plainToInstance(AuditActorQueryDto, {});
    const valid = plainToInstance(AuditActorQueryDto, { q: 'read', limit: '75' });

    expect(await validate(defaults)).toHaveLength(0);
    expect(defaults.limit).toBe(50);
    expect(await validate(valid)).toHaveLength(0);
    expect(valid.limit).toBe(75);
    expect((await validate(plainToInstance(AuditActorQueryDto, { q: 'x'.repeat(101) }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(AuditActorQueryDto, { limit: '101' }))).length).toBeGreaterThan(0);
  });
});
