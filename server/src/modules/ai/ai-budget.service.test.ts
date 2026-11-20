import type { AiBudgetStore, AiReservation } from './ai-budget.repository';
import { AiBudgetService } from './ai-budget.service';
import { AiError } from './ai-client.types';
import { AI_EVENTS, AiEventsService } from './ai-events.service';
import { AiJobsBridge } from './ai-jobs-bridge.service';
import { defaultFeatureSettings, emptySlot, type AiSettingsService, type AiSettingsSnapshot } from './ai-settings.service';

interface Spend {
  month: string;
  feature: string;
  jobId: string | null;
  costMicros: number | null;
}

class MemoryBudgetStore implements AiBudgetStore {
  spends: Spend[] = [];
  reservations = new Map<string, AiReservation>();

  locked<T>(work: (store: AiBudgetStore) => Promise<T>): Promise<T> {
    return work(this);
  }
  spentMicros(month: string, feature?: string) {
    return Promise.resolve(
      this.spends
        .filter((spend) => spend.month === month && (!feature || spend.feature === feature))
        .reduce((total, spend) => total + (spend.costMicros ?? 0), 0),
    );
  }
  jobSpentMicros(jobIds: string[]) {
    const totals = new Map<string, number>();
    for (const spend of this.spends) {
      if (spend.jobId && jobIds.includes(spend.jobId)) totals.set(spend.jobId, (totals.get(spend.jobId) ?? 0) + (spend.costMicros ?? 0));
    }
    return Promise.resolve(totals);
  }
  activeReservations() {
    return Promise.resolve([...this.reservations.values()].filter((reservation) => reservation.releasedAt === null));
  }
  findReservation(jobId: string) {
    return Promise.resolve(this.reservations.get(jobId) ?? null);
  }
  buildsInMonth(month: string, feature?: string) {
    return Promise.resolve(
      [...this.reservations.values()].filter((reservation) => reservation.month === month && (!feature || reservation.feature === feature)).length,
    );
  }
  upsertReservation(reservation: Omit<AiReservation, 'releasedAt'>) {
    const existing = this.reservations.get(reservation.jobId);
    this.reservations.set(reservation.jobId, { ...(existing ?? reservation), amountMicros: reservation.amountMicros, releasedAt: null });
    return Promise.resolve();
  }
  release(jobIds: string[], at: Date) {
    for (const jobId of jobIds) {
      const reservation = this.reservations.get(jobId);
      if (reservation && reservation.releasedAt === null) reservation.releasedAt = at;
    }
    return Promise.resolve();
  }
}

const PRICES = { input: 1, output: 4 };

function snapshot(
  overrides: { budget?: number | null; builds?: number | null; featureBudget?: number | null; featureBuilds?: number | null; prices?: boolean } = {},
) {
  const slot = { ...emptySlot(), connectionId: 1, model: 'model-a', prices: overrides.prices === false ? null : PRICES };
  const settings: AiSettingsSnapshot = {
    slots: { fast: slot, careful: slot, vision: emptySlot() },
    slotHealth: {},
    features: {
      'story-guides': {
        ...defaultFeatureSettings('story-guides'),
        enabled: true,
        monthlyBudget: overrides.featureBudget ?? null,
        buildsPerMonth: overrides.featureBuilds ?? null,
      },
      'vision-scan': defaultFeatureSettings('vision-scan'),
      'reading-help': defaultFeatureSettings('reading-help'),
    },
    budget: { monthlyBudget: overrides.budget ?? null, buildsPerMonth: overrides.builds ?? null },
    privacy: {},
  };
  return settings;
}

function setup(settings: AiSettingsSnapshot) {
  const store = new MemoryBudgetStore();
  const bridge = new AiJobsBridge();
  const events = new AiEventsService();
  const settingsService = { snapshot: () => Promise.resolve(settings) } as unknown as AiSettingsService;
  const service = new AiBudgetService(store, settingsService, bridge, events);
  return { store, bridge, events, service };
}

const NOVEMBER = new Date('2026-11-15T12:00:00Z');
const DECEMBER = new Date('2026-12-15T12:00:00Z');

describe('AiBudgetService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOVEMBER);
  });
  afterEach(() => vi.useRealTimers());

  describe('a job that does not fit', () => {
    it('is refused when its estimate is more than the budget less spending and other reservations', async () => {
      const { store, service } = setup(snapshot({ budget: 10 }));
      store.spends.push({ month: '2026-11', feature: 'story-guides', jobId: null, costMicros: 6_000_000 });
      await expect(service.reserve({ jobId: 'a', feature: 'story-guides', amount: 3 })).resolves.toEqual({ ok: true });

      await expect(service.reserve({ jobId: 'b', feature: 'story-guides', amount: 2 })).resolves.toEqual({ ok: false, reason: 'budget' });
      expect(store.reservations.has('b')).toBe(false);
      await expect(service.reserve({ jobId: 'b', feature: 'story-guides', amount: 1 })).resolves.toEqual({ ok: true });
    });

    it('frees what a job did not spend when it is released', async () => {
      const { store, service } = setup(snapshot({ budget: 10 }));
      await service.reserve({ jobId: 'a', feature: 'story-guides', amount: 8 });
      store.spends.push({ month: '2026-11', feature: 'story-guides', jobId: 'a', costMicros: 2_000_000 });
      await expect(service.reserve({ jobId: 'b', feature: 'story-guides', amount: 3 })).resolves.toMatchObject({ ok: false });

      await service.release('a');
      await expect(service.reserve({ jobId: 'b', feature: 'story-guides', amount: 3 })).resolves.toEqual({ ok: true });
    });

    it('counts what a running job already spent against its own reservation, not twice', async () => {
      const { store, service } = setup(snapshot({ budget: 10 }));
      await service.reserve({ jobId: 'a', feature: 'story-guides', amount: 6 });
      store.spends.push({ month: '2026-11', feature: 'story-guides', jobId: 'a', costMicros: 5_000_000 });
      // Spent 5, a still holds 1: 4 are left.
      await expect(service.reserve({ jobId: 'b', feature: 'story-guides', amount: 4 })).resolves.toEqual({ ok: true });
    });

    it('lets a job spend from its own reservation while refusing others the same dollars', async () => {
      const { store, service } = setup(snapshot({ budget: 10 }));
      store.spends.push({ month: '2026-11', feature: 'story-guides', jobId: null, costMicros: 6_000_000 });
      await service.reserve({ jobId: 'a', feature: 'story-guides', amount: 3 });

      await expect(service.checkRequest({ feature: 'story-guides', jobId: 'a', worstCaseMicros: 1_000_000 })).resolves.toBeUndefined();
      const error = await service.checkRequest({ feature: 'story-guides', worstCaseMicros: 2_000_000 }).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(AiError);
      expect((error as AiError).code).toBe('budget');
    });

    it('checks a request at its worst-case cost', async () => {
      const { store, service } = setup(snapshot({ budget: 1 }));
      store.spends.push({ month: '2026-11', feature: 'story-guides', jobId: null, costMicros: 900_000 });
      await expect(service.checkRequest({ feature: 'story-guides', worstCaseMicros: 100_000 })).resolves.toBeUndefined();
      await expect(service.checkRequest({ feature: 'story-guides', worstCaseMicros: 100_001 })).rejects.toMatchObject({ code: 'budget' });
    });

    it("applies a feature's own budget below the server's", async () => {
      const { store, service } = setup(snapshot({ budget: 100, featureBudget: 1 }));
      store.spends.push({ month: '2026-11', feature: 'story-guides', jobId: null, costMicros: 800_000 });
      await expect(service.reserve({ jobId: 'a', feature: 'story-guides', amount: 0.5 })).resolves.toMatchObject({ ok: false });
      await expect(service.checkRequest({ feature: 'story-guides', worstCaseMicros: 300_000 })).rejects.toThrow(
        "This feature's monthly AI budget is used up",
      );
    });

    it('does not count a second build when the same job reserves again, and updates the amount', async () => {
      const { store, service } = setup(snapshot({ builds: 1 }));
      await service.reserve({ jobId: 'a', feature: 'story-guides', amount: 1 });
      await expect(service.reserve({ jobId: 'a', feature: 'story-guides', amount: 2 })).resolves.toEqual({ ok: true });
      expect(store.reservations.get('a')?.amountMicros).toBe(2_000_000);
      await expect(service.reserve({ jobId: 'b', feature: 'story-guides', amount: 1 })).resolves.toMatchObject({ ok: false });
    });

    it('drops reservations whose job no longer exists', async () => {
      const { store, bridge, service } = setup(snapshot({ budget: 10 }));
      await service.reserve({ jobId: 'gone', feature: 'story-guides', amount: 9 });
      bridge.register({ liveJobIds: () => Promise.resolve(new Set<string>()) });

      await expect(service.reserve({ jobId: 'b', feature: 'story-guides', amount: 9 })).resolves.toEqual({ ok: true });
      expect(store.reservations.get('gone')?.releasedAt).toEqual(NOVEMBER);
    });

    it('allows anything with no budget set', async () => {
      const { service } = setup(snapshot());
      await expect(service.reserve({ jobId: 'a', feature: 'story-guides', amount: 1_000 })).resolves.toEqual({ ok: true });
      await expect(service.checkRequest({ feature: 'story-guides', worstCaseMicros: 1e12 })).resolves.toBeUndefined();
    });
  });

  describe('the three-times cap', () => {
    it('trips at three times the estimate, and three times more after each Continue', () => {
      const { service } = setup(snapshot());
      expect(service.overEstimate({ spentMicros: 2_999_999, estimateMicros: 1_000_000, continues: 0 })).toBe(false);
      expect(service.overEstimate({ spentMicros: 3_000_000, estimateMicros: 1_000_000, continues: 0 })).toBe(true);
      expect(service.overEstimate({ spentMicros: 3_000_000, estimateMicros: 1_000_000, continues: 1 })).toBe(false);
      expect(service.overEstimate({ spentMicros: 6_000_000, estimateMicros: 1_000_000, continues: 1 })).toBe(true);
    });

    it('never trips without an estimate', () => {
      expect(setup(snapshot()).service.overEstimate({ spentMicros: 10_000_000, estimateMicros: 0, continues: 0 })).toBe(false);
    });

    it("reports a job's spending across months", async () => {
      const { store, service } = setup(snapshot());
      store.spends.push(
        { month: '2026-10', feature: 'story-guides', jobId: 'a', costMicros: 400 },
        { month: '2026-11', feature: 'story-guides', jobId: 'a', costMicros: 600 },
      );
      await expect(service.jobSpentMicros('a')).resolves.toBe(1000);
    });
  });

  describe('a month turning', () => {
    it("starts the new month with nothing spent and no builds counted, while last month's stay in its own totals", async () => {
      const { store, service } = setup(snapshot({ budget: 5, builds: 1 }));
      store.spends.push({ month: '2026-11', feature: 'story-guides', jobId: 'a', costMicros: 5_000_000 });
      await service.reserve({ jobId: 'a', feature: 'story-guides', amount: 0 });
      await service.release('a');
      await expect(service.reserve({ jobId: 'b', feature: 'story-guides', amount: 1 })).resolves.toMatchObject({ ok: false });
      await expect(service.state()).resolves.toMatchObject({ month: '2026-11', exhausted: true, used: 1, buildsThisMonth: 1 });

      vi.setSystemTime(DECEMBER);
      await expect(service.state()).resolves.toMatchObject({ month: '2026-12', spentMicros: 0, exhausted: false, buildsThisMonth: 0 });
      await expect(service.reserve({ jobId: 'b', feature: 'story-guides', amount: 1 })).resolves.toEqual({ ok: true });
      await expect(service.checkRequest({ feature: 'story-guides', jobId: 'b', worstCaseMicros: 1_000_000 })).resolves.toBeUndefined();
    });

    it('tells paused jobs to look again when the month turns', () => {
      const { events, service } = setup(snapshot());
      const listener = vi.fn();
      events.on(AI_EVENTS.BUDGET_CHANGED, listener);
      service.monthTurned();
      expect(listener).toHaveBeenCalledOnce();
    });

    it('warns from 80%', async () => {
      const { store, service } = setup(snapshot({ budget: 10 }));
      store.spends.push({ month: '2026-11', feature: 'story-guides', jobId: null, costMicros: 7_999_999 });
      await expect(service.state()).resolves.toMatchObject({ warning: false, exhausted: false });
      store.spends.push({ month: '2026-11', feature: 'story-guides', jobId: null, costMicros: 1 });
      await expect(service.state()).resolves.toMatchObject({ warning: true, exhausted: false, used: 0.8 });
    });
  });

  describe('no prices', () => {
    it('counts builds per month instead of dollars', async () => {
      const { service } = setup(snapshot({ prices: false, budget: 10, builds: 2 }));
      await expect(service.state()).resolves.toMatchObject({ countsBuilds: true, buildsPerMonth: 2 });
      await expect(service.reserve({ jobId: 'a', feature: 'story-guides', amount: null })).resolves.toEqual({ ok: true });
      await expect(service.reserve({ jobId: 'b', feature: 'story-guides', amount: null })).resolves.toEqual({ ok: true });
      await expect(service.reserve({ jobId: 'c', feature: 'story-guides', amount: null })).resolves.toEqual({ ok: false, reason: 'budget' });
      await expect(service.state()).resolves.toMatchObject({ buildsThisMonth: 2, exhausted: true });
    });

    it("applies the feature's builds per month too", async () => {
      const { service } = setup(snapshot({ prices: false, featureBuilds: 1 }));
      await service.reserve({ jobId: 'a', feature: 'story-guides', amount: null });
      await expect(service.reserve({ jobId: 'b', feature: 'story-guides', amount: null })).resolves.toMatchObject({ ok: false });
    });

    it('lets an unpriced request through until the dollars counted from priced ones run out', async () => {
      const { store, service } = setup(snapshot({ prices: false, budget: 1 }));
      await expect(service.checkRequest({ feature: 'story-guides', worstCaseMicros: null })).resolves.toBeUndefined();
      store.spends.push({ month: '2026-11', feature: 'story-guides', jobId: null, costMicros: 1_000_000 });
      await expect(service.checkRequest({ feature: 'story-guides', worstCaseMicros: null })).rejects.toMatchObject({ code: 'budget' });
    });

    it('does not count builds while every slot in use has prices', async () => {
      await expect(setup(snapshot({ builds: 5 })).service.state()).resolves.toMatchObject({ countsBuilds: false });
    });
  });
});
