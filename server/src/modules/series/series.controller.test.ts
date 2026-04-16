import 'reflect-metadata';

import { BadRequestException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { SeriesController } from './series.controller';

function makeUser(overrides?: Partial<RequestUser>): RequestUser {
  return {
    id: 11,
    username: 'series-reader',
    name: 'Series Reader',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,
  };
}

function makeController() {
  const seriesService = {
    findAll: vi.fn(),
    findBooks: vi.fn(),
  };

  const controller = new SeriesController(seriesService as any);
  return { controller, seriesService };
}

describe('SeriesController', () => {
  it('findAll delegates to service', async () => {
    const { controller, seriesService } = makeController();
    const user = makeUser();
    const dto = { page: 0, size: 50 };
    const expected = { items: [], total: 0, page: 0, size: 50 };
    seriesService.findAll.mockResolvedValue(expected);

    const result = await controller.findAll(user, dto as any);

    expect(seriesService.findAll).toHaveBeenCalledWith(user, dto);
    expect(result).toBe(expected);
  });

  it('findBooks delegates to service with decoded param', async () => {
    const { controller, seriesService } = makeController();
    const user = makeUser();
    const dto = { page: 0, size: 50 };
    const expected = {
      items: [],
      total: 0,
      page: 0,
      size: 50,
      seriesInfo: { name: 'Harry Potter', bookCount: 0, readCount: 0, authors: [], possibleGaps: [] },
    };
    seriesService.findBooks.mockResolvedValue(expected);

    const result = await controller.findBooks(user, 'Harry Potter', dto as any);

    expect(seriesService.findBooks).toHaveBeenCalledWith(user, 'Harry Potter', dto);
    expect(result).toBe(expected);
  });

  describe('seriesName validation', () => {
    it('trims whitespace from seriesName', async () => {
      const { controller, seriesService } = makeController();
      seriesService.findBooks.mockResolvedValue({ items: [] });

      await controller.findBooks(makeUser(), '  Harry Potter  ', {} as any);
      expect(seriesService.findBooks).toHaveBeenCalledWith(expect.anything(), 'Harry Potter', expect.anything());
    });

    it('passes already-decoded param as-is', async () => {
      const { controller, seriesService } = makeController();
      seriesService.findBooks.mockResolvedValue({ items: [] });

      await controller.findBooks(makeUser(), 'Harry Potter', {} as any);
      expect(seriesService.findBooks).toHaveBeenCalledWith(expect.anything(), 'Harry Potter', expect.anything());
    });

    it('handles names with special characters', async () => {
      const { controller, seriesService } = makeController();
      seriesService.findBooks.mockResolvedValue({ items: [] });

      await controller.findBooks(makeUser(), 'A & B / C', {} as any);
      expect(seriesService.findBooks).toHaveBeenCalledWith(expect.anything(), 'A & B / C', expect.anything());
    });

    it('handles names with percent sign', async () => {
      const { controller, seriesService } = makeController();
      seriesService.findBooks.mockResolvedValue({ items: [] });

      await controller.findBooks(makeUser(), '100% Complete', {} as any);
      expect(seriesService.findBooks).toHaveBeenCalledWith(expect.anything(), '100% Complete', expect.anything());
    });

    it('throws BadRequestException for empty seriesName', () => {
      const { controller } = makeController();
      expect(() => controller.findBooks(makeUser(), '', {} as any)).toThrow(BadRequestException);
    });

    it('throws BadRequestException for whitespace-only seriesName', () => {
      const { controller } = makeController();
      expect(() => controller.findBooks(makeUser(), '   ', {} as any)).toThrow(BadRequestException);
    });

    it('throws BadRequestException for seriesName exceeding max length', () => {
      const { controller } = makeController();
      const longName = 'A'.repeat(501);
      expect(() => controller.findBooks(makeUser(), longName, {} as any)).toThrow(BadRequestException);
    });

    it('accepts seriesName at max length boundary', async () => {
      const { controller, seriesService } = makeController();
      seriesService.findBooks.mockResolvedValue({ items: [] });
      const name = 'A'.repeat(500);

      await controller.findBooks(makeUser(), name, {} as any);
      expect(seriesService.findBooks).toHaveBeenCalledWith(expect.anything(), name, expect.anything());
    });
  });
});
