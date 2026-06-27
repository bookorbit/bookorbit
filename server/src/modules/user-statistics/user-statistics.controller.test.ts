import { UserStatisticsController } from './user-statistics.controller';

function makeService() {
  return {
    getSummary: vi.fn().mockResolvedValue('summary'),
    getDailyReading: vi.fn().mockResolvedValue('daily'),
    getReadingHeatmap: vi.fn().mockResolvedValue('heatmap'),
    getReadingSourceDistribution: vi.fn().mockResolvedValue('source-distribution'),
    getPeakReadingHours: vi.fn().mockResolvedValue('peak-hours'),
    getFavoriteReadingDays: vi.fn().mockResolvedValue('favorite-days'),
    getSessionTimeline: vi.fn().mockResolvedValue('timeline'),
    updateSessionTimelineSession: vi.fn().mockResolvedValue('updated-session'),
    getCompletionTimeline: vi.fn().mockResolvedValue('completion-timeline'),
    getGoalTrajectory: vi.fn().mockResolvedValue('goal'),
    getProgressFunnel: vi.fn().mockResolvedValue('funnel'),
    getCompletionLatency: vi.fn().mockResolvedValue('latency'),
    getGenreReadingTime: vi.fn().mockResolvedValue('genre-time'),
    getReadingPace: vi.fn().mockResolvedValue('pace'),
    getReadingSurvival: vi.fn().mockResolvedValue('survival'),
    getCompletionRace: vi.fn().mockResolvedValue('race'),
    getSessionArchetypes: vi.fn().mockResolvedValue('archetypes'),
    getAuthorGenreChord: vi.fn().mockResolvedValue('chord'),
  };
}

describe('UserStatisticsController', () => {
  it('delegates each endpoint handler to UserStatisticsService', async () => {
    const service = makeService();
    const controller = new UserStatisticsController(service as never);
    const user = { id: 11, isSuperuser: false } as never;
    const filter = { libraryIds: [1, 2] } as never;
    const daily = { ...filter, days: 30 } as never;
    const timeline = { ...filter, year: 2026, week: 10 } as never;
    const goal = { ...daily, goalBooks: 18 } as never;
    const updateDto = { startedAt: '2026-04-10T10:00:00.000Z', endedAt: '2026-04-10T10:30:00.000Z' } as never;

    await expect(controller.getSummary(user, filter)).resolves.toBe('summary');
    await expect(controller.getDailyReading(user, daily)).resolves.toBe('daily');
    await expect(controller.getReadingHeatmap(user, daily)).resolves.toBe('heatmap');
    await expect(controller.getReadingSourceDistribution(user, daily)).resolves.toBe('source-distribution');
    await expect(controller.getPeakHours(user, daily)).resolves.toBe('peak-hours');
    await expect(controller.getFavoriteDays(user, daily)).resolves.toBe('favorite-days');
    await expect(controller.getSessionTimeline(user, timeline)).resolves.toBe('timeline');
    await expect(controller.updateSessionTimelineSession(user, 77, updateDto, filter)).resolves.toBe('updated-session');
    await expect(controller.getCompletionTimeline(user, daily)).resolves.toBe('completion-timeline');
    await expect(controller.getGoalTrajectory(user, goal)).resolves.toBe('goal');
    await expect(controller.getProgressFunnel(user, daily)).resolves.toBe('funnel');
    await expect(controller.getCompletionLatency(user, daily)).resolves.toBe('latency');
    await expect(controller.getGenreReadingTime(user, daily)).resolves.toBe('genre-time');
    await expect(controller.getReadingPace(user, daily)).resolves.toBe('pace');
    await expect(controller.getReadingSurvival(user, daily)).resolves.toBe('survival');
    await expect(controller.getCompletionRace(user, daily)).resolves.toBe('race');
    await expect(controller.getSessionArchetypes(user, daily)).resolves.toBe('archetypes');
    await expect(controller.getAuthorGenreChord(user, daily)).resolves.toBe('chord');

    expect(service.getSummary).toHaveBeenCalledWith(user, filter);
    expect(service.getDailyReading).toHaveBeenCalledWith(user, daily);
    expect(service.getReadingHeatmap).toHaveBeenCalledWith(user, daily);
    expect(service.getReadingSourceDistribution).toHaveBeenCalledWith(user, daily);
    expect(service.getPeakReadingHours).toHaveBeenCalledWith(user, daily);
    expect(service.getFavoriteReadingDays).toHaveBeenCalledWith(user, daily);
    expect(service.getSessionTimeline).toHaveBeenCalledWith(user, timeline);
    expect(service.updateSessionTimelineSession).toHaveBeenCalledWith(user, 77, updateDto, filter);
    expect(service.getCompletionTimeline).toHaveBeenCalledWith(user, daily);
    expect(service.getGoalTrajectory).toHaveBeenCalledWith(user, goal);
    expect(service.getProgressFunnel).toHaveBeenCalledWith(user, daily);
    expect(service.getCompletionLatency).toHaveBeenCalledWith(user, daily);
    expect(service.getGenreReadingTime).toHaveBeenCalledWith(user, daily);
    expect(service.getReadingPace).toHaveBeenCalledWith(user, daily);
    expect(service.getReadingSurvival).toHaveBeenCalledWith(user, daily);
    expect(service.getCompletionRace).toHaveBeenCalledWith(user, daily);
    expect(service.getSessionArchetypes).toHaveBeenCalledWith(user, daily);
    expect(service.getAuthorGenreChord).toHaveBeenCalledWith(user, daily);
  });
});
