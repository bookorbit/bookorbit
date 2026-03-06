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

  it('delegates recommendation lookup to the service', async () => {
    const recommendation = [{ book: { id: 10 }, score: 0.9 }];
    const recommendationService = {
      getRecommendations: jest.fn().mockResolvedValue(recommendation),
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
      roles: [],
    };

    await expect(controller.getRecommendations(10, user)).resolves.toEqual(recommendation);
    expect(recommendationService.getRecommendations).toHaveBeenCalledWith(10, user);
  });
});
