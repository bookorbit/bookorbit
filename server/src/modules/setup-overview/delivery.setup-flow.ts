import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { SetupCell, SetupFlowCard, SetupMapNode, SetupStep, SetupText, SetupWarning } from '@bookorbit/types';

import { DeliveryRepository, type DeliverySummary } from './delivery.repository';
import { setupTextFor, type SetupFlowContribution, type SetupFlowContributor } from './setup-flow';
import { SetupFlowRegistry } from './setup-flow.registry';

const t = setupTextFor('out');

/**
 * "Books going out": the devices and accounts a book can reach once it is in the library.
 *
 * This is the one card that is not owned by a single feature module, because it spans four of
 * them. It reads counts only, through its own repository, and never names a device or an address.
 */
@Injectable()
export class DeliverySetupFlow implements SetupFlowContributor, OnModuleInit {
  readonly id = 'out' as const;

  constructor(
    private readonly registry: SetupFlowRegistry,
    private readonly repository: DeliveryRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async build(): Promise<SetupFlowContribution> {
    const summary = await this.repository.summary();
    const places = this.places(summary);
    if (places === 0) return { card: null, stats: [], map: null };
    return {
      card: this.card(summary, places),
      stats: [{ code: 'outlets', label: t('stats.places', { count: places }), value: places }],
      map: { out: this.outlets(summary) },
    };
  }

  /** The map's right-hand column: the same places as the card's fan, one line each. */
  private outlets(summary: DeliverySummary): SetupMapNode[] {
    return this.steps(summary)
      .filter((step) => !step.terminal)
      .map((step) => ({ id: step.id, icon: step.icon, label: step.label, sub: step.lines[0] ?? null }));
  }

  private card(summary: DeliverySummary, places: number): SetupFlowCard {
    const warnings = this.warnings(summary);

    return {
      id: this.id,
      icon: 'send',
      shape: 'fan',
      title: t('title'),
      summary: t('summary', { places }),
      state: warnings.length > 0 ? 'attention' : 'ok',
      stateLabel: warnings.length > 0 ? t('state.attention', { count: warnings.length }) : t('state.ok'),
      steps: this.steps(summary),
      branch: null,
      facts: this.facts(summary),
      table: this.table(summary),
      warnings,
      links: [
        { label: t('links.kobo'), icon: 'folder-sync', url: '/settings/kobo' },
        { label: t('links.koreader'), icon: 'tablet', url: '/settings/koreader' },
        { label: t('links.opds'), icon: 'rss', url: '/settings/opds' },
        { label: t('links.email'), icon: 'mail', url: '/settings/email' },
      ],
    };
  }

  /** How many of the four ways out are actually set up. */
  private places(summary: DeliverySummary): number {
    return [summary.koboDevices, summary.koreaderAccounts, summary.opdsAccounts, summary.emailProviders].filter((n) => n > 0).length;
  }

  /** The library first, then everywhere a book goes from it, all at once rather than in turn. */
  private steps(summary: DeliverySummary): SetupStep[] {
    const steps: SetupStep[] = [
      { id: 'library', icon: 'library', label: t('steps.library'), lines: [t('lines.library')], edge: null, terminal: true },
    ];
    if (summary.koboDevices > 0) {
      steps.push({
        id: 'kobo',
        icon: 'folder-sync',
        label: t('steps.kobo'),
        lines: [t('lines.koboA', { count: summary.koboDevices }), summary.koboKepub > 0 ? t('lines.koboKepub') : t('lines.koboEpub')],
        edge: null,
      });
    }
    if (summary.koreaderAccounts > 0) {
      steps.push({
        id: 'koreader',
        icon: 'tablet',
        label: t('steps.koreader'),
        lines: [t('lines.koreaderA', { count: summary.koreaderAccounts })],
        edge: null,
      });
    }
    if (summary.opdsAccounts > 0) {
      steps.push({ id: 'opds', icon: 'rss', label: t('steps.opds'), lines: [t('lines.opdsA', { count: summary.opdsAccounts })], edge: null });
    }
    if (summary.emailProviders > 0) {
      steps.push({
        id: 'email',
        icon: 'mail',
        label: t('steps.email'),
        lines: [t('lines.emailA', { count: summary.emailProviders }), t('lines.emailB', { count: summary.emailRecipients })],
        edge: null,
      });
    }
    return steps;
  }

  private facts(summary: DeliverySummary): SetupText[] {
    const facts: SetupText[] = [];
    if (summary.koboTwoWay > 0) facts.push(t('facts.twoWay', { count: summary.koboTwoWay }));
    if (summary.emailShared > 0) facts.push(t('facts.sharedMail', { count: summary.emailShared }));
    if (summary.opdsAccounts > 0) facts.push(t('facts.opdsReadOnly'));
    return facts;
  }

  private table(summary: DeliverySummary): SetupFlowCard['table'] {
    const rows: SetupCell[][] = [];
    const row = (label: SetupText, set: SetupText, live: boolean): SetupCell[] => [
      { text: label },
      { text: set, dim: true },
      live ? { text: t('cells.on'), state: 'on' } : { text: t('cells.unused'), state: 'off' },
    ];
    rows.push(row(t('steps.kobo'), t('cells.koboSet', { kepub: summary.koboKepub, twoWay: summary.koboTwoWay }), summary.koboDevices > 0));
    rows.push(row(t('steps.koreader'), t('cells.koreaderSet'), summary.koreaderAccounts > 0));
    rows.push(row(t('steps.opds'), t('cells.opdsSet'), summary.opdsAccounts > 0));
    rows.push(row(t('steps.email'), t('cells.emailSet', { count: summary.emailRecipients }), summary.emailProviders > 0));
    return { columns: [t('table.goesTo'), t('table.howSet'), t('table.state')], rows };
  }

  private warnings(summary: DeliverySummary): SetupWarning[] {
    if (summary.emailRecipients === 0 && summary.emailProviders > 0) {
      return [
        {
          code: 'mail_without_recipient',
          subject: null,
          detail: t('warnings.noRecipient'),
          fix: t('warnings.fix.openEmail'),
          url: '/settings/email',
        },
      ];
    }
    return [];
  }
}
