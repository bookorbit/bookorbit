import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import type { RequestUser } from '../../common/types/request-user';
import { RecommendationController } from './recommendation.controller';

describe('RecommendationController', () => {
  it('keeps the expected route contract for recommendations endpoint', () => {
    const classPath = Reflect.getMetadata(PATH_METADATA, RecommendationController);
    const methodPath = Reflect.getMetadata(PATH_METADATA, RecommendationController.prototype.getRecommendations);
    const methodType = Reflect.getMetadata(METHOD_METADATA, RecommendationController.prototype.getRecommendations);

    expect(classPath).toBe('books');
    expect(methodPath).toBe(':id/recommendations');
    expect(methodType).toBe(RequestMethod.GET);
  });

  it('keeps the expected route contract for series-books endpoint', () => {
    const classPath = Reflect.getMetadata(PATH_METADATA, RecommendationController);
    const methodPath = Reflect.getMetadata(PATH_METADATA, RecommendationController.prototype.getSeriesBooks);
    const methodType = Reflect.getMetadata(METHOD_METADATA, RecommendationController.prototype.getSeriesBooks);

    expect(classPath).toBe('books');
    expect(methodPath).toBe(':id/series-books');
    expect(methodType).toBe(RequestMethod.GET);
  });

  it('keeps the expected route contract for author-books endpoint', () => {
    const classPath = Reflect.getMetadata(PATH_METADATA, RecommendationController);
    const methodPath = Reflect.getMetadata(PATH_METADATA, RecommendationController.prototype.getAuthorBooks);
    const methodType = Reflect.getMetadata(METHOD_METADATA, RecommendationController.prototype.getAuthorBooks);

    expect(classPath).toBe('books');
    expect(methodPath).toBe(':id/author-books');
    expect(methodType).toBe(RequestMethod.GET);
  });

  it('delegates recommendation lookup to the service', async () => {
    const recommendation = [{ id: 10, title: 'Book 10' }];
    const recommendationService = {
      getRecommendations: vi.fn().mockResolvedValue(recommendation),
    };

    const controller = new RecommendationController(recommendationService as never);
    const user: RequestUser = {
      id: 1,
      username: 'user',
      name: 'User',
      email: null,
      active: true,
      isDefaultPassword: false,
      tokenVersion: 1,
      settings: {},
      avatarUrl: null,
      provisioningMethod: 'local',
      isSuperuser: false,
      permissions: [],
    };

    await expect(controller.getRecommendations(10, user)).resolves.toEqual(recommendation);
    expect(recommendationService.getRecommendations).toHaveBeenCalledWith(10, user);
  });

  it('delegates series books lookup to the service', async () => {
    const seriesBooks = [{ id: 1, title: 'Book 1', seriesIndex: 1 }];
    const recommendationService = {
      getSeriesBooks: vi.fn().mockResolvedValue(seriesBooks),
    };

    const controller = new RecommendationController(recommendationService as never);
    const user: RequestUser = {
      id: 1,
      username: 'user',
      name: 'User',
      email: null,
      active: true,
      isDefaultPassword: false,
      tokenVersion: 1,
      settings: {},
      avatarUrl: null,
      provisioningMethod: 'local',
      isSuperuser: false,
      permissions: [],
    };

    await expect(controller.getSeriesBooks(5, user)).resolves.toEqual(seriesBooks);
    expect(recommendationService.getSeriesBooks).toHaveBeenCalledWith(5, user);
  });

  it('delegates author books lookup to the service', async () => {
    const authorBooks = [{ id: 2, title: 'Book 2' }];
    const recommendationService = {
      getAuthorBooks: vi.fn().mockResolvedValue(authorBooks),
    };

    const controller = new RecommendationController(recommendationService as never);
    const user: RequestUser = {
      id: 1,
      username: 'user',
      name: 'User',
      email: null,
      active: true,
      isDefaultPassword: false,
      tokenVersion: 1,
      settings: {},
      avatarUrl: null,
      provisioningMethod: 'local',
      isSuperuser: false,
      permissions: [],
    };

    await expect(controller.getAuthorBooks(5, user)).resolves.toEqual(authorBooks);
    expect(recommendationService.getAuthorBooks).toHaveBeenCalledWith(5, user);
  });
});
