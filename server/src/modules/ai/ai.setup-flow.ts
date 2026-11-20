import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  AI_FEATURES,
  AI_FEATURE_DEFINITIONS,
  AI_SLOTS,
  setupRaw,
  type AiConnection,
  type AiFeatureId,
  type AiSlot,
  type AiSlotsSettings,
  type SetupCell,
  type SetupFlowCard,
  type SetupText,
  type SetupWarning,
} from '@bookorbit/types';

import { setupTextFor, type SetupFlowContribution, type SetupFlowContributor } from '../setup-overview/setup-flow';
import { SetupFlowRegistry } from '../setup-overview/setup-flow.registry';
import { AiConnectionService } from './ai-connection.service';
import { AiSettingsService, type AiFeatureSettingsMap, type AiSlotHealthMap } from './ai-settings.service';

const t = setupTextFor('ai');

type Budget = { monthlyBudget: number | null; buildsPerMonth: number | null };

const AI_PAGE = '/settings/admin/ai';

/**
 * "What the AI does": each feature, the slot it runs on, and the connection behind that slot.
 *
 * A connection's key never leaves the server and its address is nobody's business here, so the
 * card carries the name, the model and whether it is working.
 */
@Injectable()
export class AiSetupFlow implements SetupFlowContributor, OnModuleInit {
  readonly id = 'ai' as const;

  constructor(
    private readonly registry: SetupFlowRegistry,
    private readonly settings: AiSettingsService,
    private readonly connections: AiConnectionService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async build(): Promise<SetupFlowContribution> {
    const [{ slots, features, budget, slotHealth: health }, list] = await Promise.all([this.settings.snapshot(), this.connections.list()]);

    if (list.length === 0) return { card: null, stats: [], map: null };

    return {
      card: this.card(slots, features, budget, health, list),
      stats: [{ code: 'aiConnections', label: t('stats.connections', { count: list.length }), value: list.length }],
      map: {
        services: [
          {
            id: 'ai',
            icon: 'sparkles',
            label: t('map.service'),
            sub:
              budget.monthlyBudget === null
                ? t('map.serviceSub', { count: list.length })
                : t('map.serviceBudget', { count: list.length, amount: budget.monthlyBudget }, ['amount']),
            asks: null,
          },
        ],
      },
    };
  }

  private card(slots: AiSlotsSettings, features: AiFeatureSettingsMap, budget: Budget, health: AiSlotHealthMap, list: AiConnection[]): SetupFlowCard {
    const byId = new Map(list.map((c) => [c.id, c]));
    const live = AI_FEATURES.filter((id) => features[id]?.enabled);
    const warnings = this.warnings(slots, health, features, byId);
    const wired = AI_SLOTS.filter((slot) => {
      const id = slots[slot]?.connectionId;
      return id != null && byId.has(id);
    });

    return {
      id: this.id,
      icon: 'sparkles',
      title: t('title'),
      summary: t('summary', { features: live.length, connections: list.length }),
      state: warnings.length > 0 ? 'attention' : live.length === 0 ? 'off' : 'ok',
      stateLabel: warnings.length > 0 ? t('state.attention', { count: warnings.length }) : live.length === 0 ? t('state.off') : t('state.ok'),
      steps: [
        { id: 'asks', icon: 'sparkles', label: t('steps.asks'), lines: [t('lines.asksA', { count: live.length })], edge: t('edges.slot') },
        {
          id: 'slot',
          icon: 'sliders-horizontal',
          label: t('steps.slot'),
          lines: [t('lines.slotA'), t('lines.slotB', { count: wired.length, total: AI_SLOTS.length })],
          edge: t('edges.runsOn'),
        },
        {
          id: 'runs',
          icon: 'bot',
          label: t('steps.runs'),
          lines: [t('lines.runsA', { count: list.length })],
          edge: budget.monthlyBudget === null ? t('edges.noBudget') : t('edges.budget', { amount: budget.monthlyBudget }, ['amount']),
        },
        { id: 'kept', icon: 'check-check', label: t('steps.kept'), lines: [t('lines.keptA'), t('lines.keptB')], edge: null, terminal: true },
      ],
      branch: null,
      facts: this.facts(budget, list),
      table: {
        columns: [t('table.feature'), t('table.slot'), t('table.connection'), t('table.model'), t('table.state')],
        rows: AI_FEATURES.flatMap((id) => this.rows(id, slots, health, byId, features[id]?.enabled ?? false)),
      },
      warnings,
      links: [
        { label: t('links.connections'), icon: 'bot', url: AI_PAGE },
        { label: t('links.features'), icon: 'sparkles', url: AI_PAGE },
      ],
    };
  }

  private facts(budget: Budget, list: AiConnection[]): SetupText[] {
    const facts: SetupText[] = [];
    facts.push(budget.monthlyBudget === null ? t('facts.noBudget') : t('facts.budget', { amount: budget.monthlyBudget }, ['amount']));
    if (budget.buildsPerMonth !== null) facts.push(t('facts.builds', { count: budget.buildsPerMonth }));
    const unusable = list.filter((c) => !c.usable).length;
    if (unusable > 0) facts.push(t('facts.unusable', { count: unusable }));
    return facts;
  }

  /** One row per slot a feature uses, because that is where the model is actually chosen. */
  private rows(id: AiFeatureId, slots: AiSlotsSettings, health: AiSlotHealthMap, byId: Map<number, AiConnection>, enabled: boolean): SetupCell[][] {
    const definition = AI_FEATURE_DEFINITIONS[id];
    return definition.slots.map((slot: AiSlot) => {
      const setting = slots[slot];
      const connection = setting?.connectionId === null || setting?.connectionId === undefined ? null : (byId.get(setting.connectionId) ?? null);
      return [
        { text: t(`features.${id}`) },
        { text: t(`slots.${slot}`), dim: true },
        { text: connection ? setupRaw(connection.name) : t('cells.noConnection') },
        { text: setting?.model ? setupRaw(setting.model) : t('cells.noModel') },
        this.state(slot, health, enabled, connection),
      ];
    });
  }

  private state(slot: AiSlot, health: AiSlotHealthMap, enabled: boolean, connection: AiConnection | null): SetupCell {
    if (!enabled) return { text: t('cells.featureOff'), state: 'off' };
    if (!connection) return { text: t('cells.unset'), state: 'warn' };
    if (health[slot]) return { text: t('cells.failing'), state: 'bad' };
    return { text: t('cells.working'), state: 'on' };
  }

  /**
   * One warning per slot that a switched-on feature needs, however many features share it: three
   * features on an unset slot are one thing to fix, not three.
   */
  private warnings(slots: AiSlotsSettings, health: AiSlotHealthMap, features: AiFeatureSettingsMap, byId: Map<number, AiConnection>): SetupWarning[] {
    const needed = new Set(AI_FEATURES.filter((id) => features[id]?.enabled).flatMap((id) => AI_FEATURE_DEFINITIONS[id].slots as AiSlot[]));
    const out: SetupWarning[] = [];
    for (const slot of AI_SLOTS.filter((s) => needed.has(s))) {
      const setting = slots[slot];
      const connection = setting?.connectionId == null ? null : byId.get(setting.connectionId);
      if (!connection) {
        out.push({
          code: 'slot_without_connection',
          subject: null,
          detail: t(`warnings.slotUnset.${slot}`),
          fix: t('warnings.fix.openAi'),
          url: AI_PAGE,
        });
      } else if (health[slot]) {
        out.push({ code: 'slot_failing', subject: connection.name, detail: t('warnings.slotFailing'), fix: t('warnings.fix.testIt'), url: AI_PAGE });
      }
    }
    return out;
  }
}
