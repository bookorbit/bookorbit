import {
  createRouter,
  createWebHistory,
  type LocationQuery,
  type RouteLocation,
  type RouteLocationNormalizedLoaded,
  type RouteRecordRaw,
} from 'vue-router'
import { Permission } from '@bookorbit/types'
import { normalizeEmailTab } from '@/features/email/lib/email-tabs'
import { normalizeMetadataTab, type MetadataTab } from '@/features/settings/lib/metadata-tabs'
import { normalizeReaderTab, type ReaderTab } from '@/features/settings/lib/reader-tabs'
import { normalizeAdminTab, type AdminTab } from '@/features/settings/lib/admin-tabs'
import { normalizeSystemTab, type SystemTab } from '@/features/settings/lib/system-tabs'
import { normalizeAccountTab, type AccountTab } from '@/features/settings/lib/account-tabs'
import { normalizeAppearanceTab, type AppearanceTab } from '@/features/settings/lib/appearance-tabs'
import { normalizeIntegrationTab, type IntegrationTab } from '@/features/settings/lib/integration-tabs'
import { i18n } from '@/i18n'
import { registerAuthGuard } from './guards/auth.guard'
import { registerRouteTitleHook } from './title-resolver'

const t = i18n.global.t

function firstText(value: unknown): string | null {
  if (Array.isArray(value)) return firstText(value[0])
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function numericParam(to: RouteLocationNormalizedLoaded, key: string): number | null {
  const value = firstText(to.params[key])
  if (!value) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function fallbackById(prefixKey: string, id: number | null): string {
  const prefix = t(prefixKey)
  return id === null ? prefix : `${prefix} #${id}`
}

function resolveEmailTitle(to: RouteLocationNormalizedLoaded): string {
  const tab = normalizeEmailTab(to.query.tab)
  return `${t(`titles.email.${tab}`)} · ${t('titles.emailSuffix')}`
}

function resolveStatisticsTitle(): string {
  return t('titles.statistics')
}

const ACCOUNT_ROUTES: Record<AccountTab, string> = {
  profile: 'settings-account-profile',
  privacy: 'settings-account-privacy',
  notifications: 'settings-notifications',
  restrictions: 'settings-account-restrictions',
}

const APPEARANCE_ROUTES: Record<AppearanceTab, string> = {
  theme: 'settings-appearance-theme',
  'book-covers': 'settings-appearance-book-covers',
  icons: 'settings-appearance-icons',
  layout: 'settings-appearance-layout',
  behavior: 'settings-appearance-behavior',
  language: 'settings-appearance-language',
}

const READER_ROUTES: Record<ReaderTab, string> = {
  general: 'settings-reader-general',
  ebook: 'settings-reader-ebook',
  pdf: 'settings-reader-pdf',
  comics: 'settings-reader-comics',
  audio: 'settings-reader-audio',
  fonts: 'settings-reader-fonts',
}

const METADATA_ROUTES: Record<MetadataTab, string> = {
  providers: 'settings-metadata-providers',
  'field-rules': 'settings-metadata-field-rules',
  'custom-fields': 'settings-metadata-custom-fields',
  score: 'settings-metadata-score',
  'auto-fetch': 'settings-metadata-auto-fetch',
  authors: 'settings-metadata-authors',
  'genre-blocklist': 'settings-metadata-genre-blocklist',
}

const ADMIN_ROUTES: Record<AdminTab, string> = {
  users: 'settings-admin-users',
  'account-activity': 'settings-admin-account-activity',
  'magic-links': 'settings-admin-magic-links',
  oidc: 'settings-admin-oidc',
  'server-fonts': 'settings-admin-server-fonts',
}

const SYSTEM_ROUTES: Record<SystemTab, string> = {
  'file-naming': 'settings-file-naming',
  'book-dock': 'settings-admin-book-dock',
  requests: 'settings-admin-requests',
  maintenance: 'settings-maintenance',
  'audit-log': 'settings-admin-audit-log',
}

const INTEGRATION_ROUTES: Record<IntegrationTab, string> = {
  hardcover: 'settings-hardcover',
  readwise: 'settings-readwise',
  storygraph: 'settings-storygraph',
}

/** Settings pages are their own routes now, so the legacy `?tab=` value is consumed by the redirect. */
function withoutTab(query: LocationQuery): LocationQuery {
  const next = { ...query }
  delete next.tab
  return next
}

function tabRedirect<T extends string>(normalize: (value: unknown) => T, routes: Record<T, string>) {
  return (to: RouteLocation) => ({ name: routes[normalize(to.query.tab)], query: withoutTab(to.query) })
}

function resolveIntegrationRedirect(to: RouteLocation) {
  const legacyRoute = resolveLegacyIntegrationRoute(to.query.tab)
  const name = legacyRoute ?? INTEGRATION_ROUTES[normalizeIntegrationTab(to.query.tab)]
  return { name, query: withoutTab(to.query) }
}

function resolveLegacyIntegrationRoute(tab: unknown): string | null {
  switch (firstText(tab)) {
    case 'koreader':
      return 'settings-koreader'
    case 'kobo':
      return 'settings-kobo'
    default:
      return null
  }
}

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('@/components/AppLayout.vue'),
    children: [
      {
        path: '',
        name: 'dashboard',
        component: () => import('@/views/DashboardView.vue'),
        meta: { title: () => t('titles.dashboard') },
      },
      {
        path: '/settings',
        component: () => import('@/views/SettingsView.vue'),
        children: [
          { path: '', redirect: { name: 'settings-appearance-theme' } },

          // ── You ────────────────────────────────────────────────────────────
          {
            path: 'account',
            name: 'settings-account',
            redirect: tabRedirect(normalizeAccountTab, ACCOUNT_ROUTES),
          },
          {
            path: 'account/profile',
            name: 'settings-account-profile',
            component: () => import('@/features/settings/AccountSettings.vue'),
            props: { embedded: true },
            meta: { title: () => t('titles.account.profile') },
          },
          {
            path: 'account/privacy',
            name: 'settings-account-privacy',
            component: () => import('@/features/settings/PrivacySharingSettings.vue'),
            meta: { maxWidth: 'max-w-4xl', title: () => t('titles.account.privacy') },
          },
          {
            path: 'account/notifications',
            name: 'settings-notifications',
            component: () => import('@/features/notifications/components/NotificationPreferences.vue'),
            props: { embedded: true },
            meta: {
              requiredPermission: Permission.NotificationAccess,
              forbiddenPermission: Permission.DemoRestricted,
              permissionFallback: 'settings-account-profile',
              title: () => t('titles.account.notifications'),
            },
          },
          {
            path: 'account/restrictions',
            name: 'settings-account-restrictions',
            component: () => import('@/features/settings/ContentRestrictionsSettings.vue'),
            meta: { title: () => t('titles.account.restrictions') },
          },
          {
            path: 'appearance',
            name: 'settings-appearance',
            redirect: tabRedirect(normalizeAppearanceTab, APPEARANCE_ROUTES),
          },
          {
            path: 'appearance/theme',
            name: 'settings-appearance-theme',
            component: () => import('@/features/settings/AppearanceThemeSettings.vue'),
            meta: { title: () => t('titles.appearance.theme') },
          },
          {
            path: 'appearance/book-covers',
            name: 'settings-appearance-book-covers',
            component: () => import('@/features/settings/AppearanceBookCoverSettings.vue'),
            meta: { title: () => t('titles.appearance.book-covers') },
          },
          {
            path: 'appearance/icons',
            name: 'settings-appearance-icons',
            component: () => import('@/features/settings/AppearanceIconsSettings.vue'),
            meta: { title: () => t('titles.appearance.icons') },
          },
          {
            path: 'appearance/layout',
            name: 'settings-appearance-layout',
            component: () => import('@/features/settings/AppearanceLayoutSettings.vue'),
            meta: { title: () => t('titles.appearance.layout') },
          },
          {
            path: 'appearance/behavior',
            name: 'settings-appearance-behavior',
            component: () => import('@/features/settings/AppearanceBehaviorSettings.vue'),
            meta: { title: () => t('titles.appearance.behavior') },
          },
          {
            path: 'appearance/language',
            name: 'settings-appearance-language',
            component: () => import('@/features/settings/AppearanceLanguageSettings.vue'),
            meta: { title: () => t('titles.appearance.language') },
          },
          {
            path: 'reader',
            name: 'settings-reader',
            redirect: tabRedirect(normalizeReaderTab, READER_ROUTES),
          },
          {
            path: 'reader/ebook',
            name: 'settings-reader-ebook',
            component: () => import('@/features/settings/EbookSettings.vue'),
            props: { embedded: true },
            meta: { title: () => t('titles.reader.ebook') },
          },
          {
            path: 'reader/pdf',
            name: 'settings-reader-pdf',
            component: () => import('@/features/settings/PdfSettings.vue'),
            props: { embedded: true },
            meta: { title: () => t('titles.reader.pdf') },
          },
          {
            path: 'reader/comics',
            name: 'settings-reader-comics',
            component: () => import('@/features/settings/ComicsSettings.vue'),
            props: { embedded: true },
            meta: { title: () => t('titles.reader.comics') },
          },
          {
            path: 'reader/audio',
            name: 'settings-reader-audio',
            component: () => import('@/features/settings/AudioSettings.vue'),
            props: { embedded: true },
            meta: { title: () => t('titles.reader.audio') },
          },
          {
            path: 'reader/fonts',
            name: 'settings-reader-fonts',
            component: () => import('@/features/settings/FontsSettings.vue'),
            meta: { title: () => t('titles.reader.fonts') },
          },
          {
            path: 'reader/general',
            name: 'settings-reader-general',
            component: () => import('@/features/settings/ReaderSettings.vue'),
            props: { embedded: true },
            meta: { title: () => t('titles.reader.general') },
          },

          // ── Library ────────────────────────────────────────────────────────
          {
            path: 'libraries',
            name: 'settings-libraries',
            component: () => import('@/features/settings/LibrariesSettings.vue'),
            meta: { maxWidth: 'max-w-[82rem]', title: () => t('titles.libraries') },
          },
          {
            path: 'metadata',
            name: 'settings-metadata',
            redirect: tabRedirect(normalizeMetadataTab, METADATA_ROUTES),
          },
          {
            path: 'metadata/providers',
            name: 'settings-metadata-providers',
            component: () => import('@/features/settings/metadata-preferences/MetadataPreferencesSettings.vue'),
            meta: { maxWidth: 'max-w-5xl', title: () => t('titles.metadata.providers') },
          },
          {
            path: 'metadata/field-rules',
            name: 'settings-metadata-field-rules',
            component: () => import('@/features/settings/metadata-preferences/MetadataFieldRulesSettings.vue'),
            // The rule table needs room for a 14-chip priority order beside a merge control;
            // 6xl wrapped the chip lane while a third of a 1080p desk sat empty.
            meta: { maxWidth: 'max-w-[100rem]', title: () => t('titles.metadata.field-rules') },
          },
          {
            path: 'metadata/custom-fields',
            name: 'settings-metadata-custom-fields',
            component: () => import('@/features/settings/metadata-preferences/CustomMetadataSettings.vue'),
            meta: { maxWidth: 'max-w-4xl', title: () => t('titles.metadata.custom-fields') },
          },
          {
            path: 'metadata/score',
            name: 'settings-metadata-score',
            component: () => import('@/features/settings/metadata-score/MetadataScoreWeightsSettings.vue'),
            // The ledger splits into two ranked columns so all 24 fields land above the fold;
            // max-w-3xl fitted 720px of a 1920 pane and pushed half the list under it.
            meta: { maxWidth: 'max-w-[100rem]', title: () => t('titles.metadata.score') },
          },
          {
            path: 'metadata/auto-fetch',
            name: 'settings-metadata-auto-fetch',
            component: () => import('@/features/settings/metadata-auto-fetch/BookMetadataFetchSettings.vue'),
            meta: { maxWidth: 'max-w-3xl', title: () => t('titles.metadata.auto-fetch') },
          },
          {
            path: 'metadata/authors',
            name: 'settings-metadata-authors',
            component: () => import('@/features/settings/AuthorEnrichmentSettings.vue'),
            meta: { maxWidth: 'max-w-3xl', title: () => t('titles.metadata.authors') },
          },
          {
            path: 'metadata/genre-blocklist',
            name: 'settings-metadata-genre-blocklist',
            component: () => import('@/features/settings/metadata-preferences/MetadataGenreBlocklistSettings.vue'),
            meta: { maxWidth: 'max-w-3xl', title: () => t('titles.metadata.genre-blocklist') },
          },
          {
            path: 'library/file-naming',
            name: 'settings-file-naming',
            component: () => import('@/features/settings/FileNamingSettings.vue'),
            props: { embedded: true },
            meta: { maxWidth: 'max-w-[100rem]', title: () => t('titles.system.file-naming') },
          },
          {
            path: 'library/maintenance',
            name: 'settings-maintenance',
            component: () => import('@/features/settings/MaintenanceSettings.vue'),
            props: { embedded: true },
            meta: { maxWidth: 'max-w-3xl', title: () => t('titles.system.maintenance') },
          },

          // ── Devices & sync ─────────────────────────────────────────────────
          {
            path: 'kobo',
            name: 'settings-kobo',
            component: () => import('@/features/settings/KoboSettings.vue'),
            meta: { maxWidth: 'max-w-4xl', title: () => t('titles.koboSync') },
          },
          {
            path: 'koreader',
            name: 'settings-koreader',
            component: () => import('@/features/settings/KoreaderSettings.vue'),
            meta: { maxWidth: 'max-w-4xl', title: () => t('titles.koreaderSync') },
          },
          {
            path: 'opds',
            name: 'settings-opds',
            component: () => import('@/features/settings/OpdsSettings.vue'),
            meta: { title: () => t('titles.opds') },
          },
          {
            path: 'email',
            name: 'settings-email',
            component: () => import('@/features/email/components/EmailSettings.vue'),
            meta: { maxWidth: 'max-w-3xl', title: resolveEmailTitle },
          },
          {
            path: 'hardcover',
            name: 'settings-hardcover',
            component: () => import('@/features/hardcover/components/HardcoverSettings.vue'),
            props: { embedded: true },
            meta: { maxWidth: 'max-w-3xl', title: () => t('settings.integrations.tabs.hardcover') },
          },
          {
            path: 'readwise',
            name: 'settings-readwise',
            component: () => import('@/features/readwise/components/ReadwiseSettings.vue'),
            props: { embedded: true },
            meta: { maxWidth: 'max-w-3xl', title: () => t('settings.integrations.tabs.readwise') },
          },
          {
            path: 'storygraph',
            name: 'settings-storygraph',
            component: () => import('@/features/storygraph/components/StorygraphSettings.vue'),
            props: { embedded: true },
            meta: { maxWidth: 'max-w-3xl', title: () => t('settings.integrations.tabs.storygraph') },
          },

          // ── Server ─────────────────────────────────────────────────────────
          {
            path: 'admin/users',
            name: 'settings-admin-users',
            component: () => import('@/features/admin/UsersPage.vue'),
            meta: { maxWidth: 'max-w-6xl', title: () => t('titles.admin.users') },
          },
          {
            path: 'admin/account-activity',
            name: 'settings-admin-account-activity',
            component: () => import('@/features/admin/AccountActivityPage.vue'),
            meta: { maxWidth: 'max-w-6xl', title: () => t('titles.admin.account-activity') },
          },
          {
            path: 'admin/account-activity/:userId/insights',
            name: 'settings-admin-shared-insights',
            component: () => import('@/features/admin/SharedReadingInsightsPage.vue'),
            props: (route) => ({ userId: Number(route.params.userId) }),
            meta: { maxWidth: 'max-w-6xl', title: () => t('titles.admin.account-activity') },
          },
          {
            path: 'admin/magic-links',
            name: 'settings-admin-magic-links',
            component: () => import('@/features/settings/MagicLinksSettings.vue'),
            props: { withHeader: false, withEmbeddedCreateAction: true },
            meta: { maxWidth: 'max-w-5xl', title: () => t('titles.admin.magic-links') },
          },
          {
            path: 'admin/oidc',
            name: 'settings-admin-oidc',
            component: () => import('@/features/settings/OidcSettings.vue'),
            props: { embedded: true },
            meta: { maxWidth: 'max-w-3xl', title: () => t('titles.admin.oidc') },
          },
          {
            path: 'admin/server-fonts',
            name: 'settings-admin-server-fonts',
            component: () => import('@/features/settings/ServerFontsSettings.vue'),
            props: { embedded: true },
            meta: { maxWidth: 'max-w-3xl', title: () => t('titles.admin.server-fonts') },
          },
          {
            path: 'admin/book-dock',
            name: 'settings-admin-book-dock',
            component: () => import('@/features/settings/BookDockSettings.vue'),
            props: { embedded: true },
            meta: { maxWidth: 'max-w-3xl', title: () => t('titles.system.book-dock') },
          },
          {
            path: 'admin/requests',
            name: 'settings-admin-requests',
            component: () => import('@/features/settings/RequestsSettings.vue'),
            props: { embedded: true },
            meta: { maxWidth: 'max-w-5xl', title: () => t('titles.system.requests') },
          },
          {
            path: 'admin/audit-log',
            name: 'settings-admin-audit-log',
            component: () => import('@/features/audit/AuditLogPage.vue'),
            props: { embedded: true },
            meta: { maxWidth: 'max-w-[96rem]', title: () => t('titles.system.audit-log') },
          },

          // ── Legacy deep links: keep every pre-rail URL working ──────────────
          { path: 'notifications', redirect: { name: 'settings-notifications' } },
          {
            path: 'admin',
            name: 'settings-admin',
            redirect: tabRedirect(normalizeAdminTab, ADMIN_ROUTES),
          },
          {
            path: 'system',
            name: 'settings-system',
            redirect: tabRedirect(normalizeSystemTab, SYSTEM_ROUTES),
          },
          {
            path: 'admin/metadata',
            name: 'settings-admin-metadata',
            redirect: tabRedirect(normalizeMetadataTab, METADATA_ROUTES),
          },
          {
            path: 'integrations',
            name: 'settings-integrations',
            redirect: resolveIntegrationRedirect,
          },
          { path: 'admin/metadata-auto-fetch', redirect: { name: 'settings-metadata-auto-fetch' } },
          { path: 'admin/file-naming', name: 'settings-admin-file-naming', redirect: { name: 'settings-file-naming' } },
          { path: 'admin/maintenance', name: 'settings-admin-maintenance', redirect: { name: 'settings-maintenance' } },
          { path: ':pathMatch(.*)*', redirect: { name: 'settings-appearance-theme' } },
        ],
      },
      {
        path: '/book-dock',
        name: 'book-dock',
        component: () => import('@/views/BookDockView.vue'),
        meta: { title: () => t('titles.bookDock') },
      },
      // A request opens as a drawer over the list rather than as its own page, but it keeps its
      // own URL: these are children so a hard load of /requests/:id renders the list underneath.
      {
        path: '/requests',
        name: 'book-requests',
        component: () => import('@/features/book-requests/BookRequestsPage.vue'),
        meta: { title: () => t('titles.bookRequests') },
        children: [
          {
            path: ':id',
            name: 'book-request-detail',
            component: () => import('@/features/book-requests/components/RequestDetailPanel.vue'),
            meta: { title: () => t('titles.bookRequestDetail') },
          },
          {
            path: ':id/releases',
            name: 'book-request-releases',
            component: () => import('@/features/book-requests/components/ReleasePickerPanel.vue'),
            meta: { title: () => t('titles.bookRequestReleases') },
          },
        ],
      },
      {
        path: '/whats-new',
        name: 'whats-new',
        component: () => import('@/features/whats-new/WhatsNewView.vue'),
        meta: { title: () => t('titles.whatsNew') },
      },
      {
        path: '/annotations',
        name: 'annotations',
        component: () => import('@/features/annotations/views/AnnotationsHubView.vue'),
        meta: { title: () => t('titles.annotations') },
      },
      {
        path: '/statistics',
        name: 'statistics',
        component: () => import('@/features/statistics/components/StatisticsPage.vue'),
        meta: { title: resolveStatisticsTitle },
        beforeEnter: (to) => {
          if (to.query.tab === 'achievements') {
            return { name: 'achievements' }
          }
        },
      },
      {
        path: '/achievements',
        name: 'achievements',
        component: () => import('@/views/AchievementsView.vue'),
        meta: { title: () => t('titles.achievements') },
      },
      {
        path: '/libraries',
        name: 'libraries',
        component: () => import('@/features/library/views/LibrariesView.vue'),
        meta: { title: () => t('titles.libraries') },
      },
      {
        path: '/smart-scopes',
        name: 'smart-scopes',
        component: () => import('@/features/smart-scope/views/SmartScopesView.vue'),
        meta: { title: () => t('titles.smartScopes') },
      },
      {
        path: '/collections',
        name: 'collections',
        component: () => import('@/features/collection/views/CollectionsView.vue'),
        meta: { title: () => t('titles.collections') },
      },
      {
        path: '/library/:id',
        name: 'library',
        component: () => import('@/views/HomeView.vue'),
        meta: {
          title: (to) => fallbackById('titles.library', numericParam(to, 'id')),
        },
      },
      {
        path: '/smart-scope/:id',
        name: 'smartScope',
        component: () => import('@/views/SmartScopeView.vue'),
        meta: {
          title: (to) => fallbackById('titles.smartScope', numericParam(to, 'id')),
        },
      },
      {
        path: '/collection/:id',
        name: 'collection',
        component: () => import('@/views/CollectionView.vue'),
        meta: {
          title: (to) => fallbackById('titles.collection', numericParam(to, 'id')),
        },
      },
      {
        path: '/authors',
        name: 'authors',
        component: () => import('@/features/author/views/AuthorsView.vue'),
        meta: { title: () => t('titles.authors') },
      },
      {
        path: '/authors/:id',
        name: 'author-detail',
        component: () => import('@/features/author/views/AuthorDetailView.vue'),
        meta: {
          title: (to) => fallbackById('titles.author', numericParam(to, 'id')),
        },
      },
      {
        path: '/series',
        name: 'series',
        component: () => import('@/features/series/views/SeriesView.vue'),
        meta: { title: () => t('titles.series') },
      },
      {
        path: '/series/:seriesId',
        name: 'series-detail',
        component: () => import('@/features/series/views/SeriesDetailView.vue'),
        meta: {
          title: (to) => fallbackById('titles.seriesItem', numericParam(to, 'seriesId')),
        },
      },
      {
        path: '/tools',
        component: () => import('@/features/tools/views/ToolsView.vue'),
        children: [
          { path: '', redirect: { name: 'tools-entity-manager' } },
          {
            path: 'entity-manager',
            name: 'tools-entity-manager',
            component: () => import('@/features/tools/entity-manager/views/EntityManagerView.vue'),
            meta: { title: () => t('titles.entityManager') },
          },
          {
            path: 'bulk-rename',
            name: 'tools-bulk-rename',
            component: () => import('@/features/tools/bulk-rename/views/BulkRenameView.vue'),
            meta: { title: () => t('titles.bulkRename') },
          },
          {
            path: 'duplicate-books',
            name: 'tools-duplicate-books',
            component: () => import('@/features/tools/book-duplicates/views/BookDuplicatesView.vue'),
            meta: { title: () => t('titles.duplicateBooks') },
          },
          {
            path: 'missing-resources',
            name: 'tools-missing-resources',
            component: () => import('@/features/tools/missing-resources/views/MissingResourcesView.vue'),
            meta: { title: () => t('titles.missingResources') },
          },
          {
            path: ':pathMatch(.*)*',
            redirect: { name: 'tools-entity-manager' },
          },
        ],
      },
      {
        path: '/book/:bookId',
        name: 'book-detail',
        component: () => import('@/views/BookDetailView.vue'),
        meta: {
          title: (to) => fallbackById('titles.book', numericParam(to, 'bookId')),
        },
        beforeEnter: (to) => {
          if (!to.query.tab) {
            return { ...to, query: { ...to.query, tab: 'details' } }
          }
        },
      },
      {
        path: '/book/:bookId/files',
        redirect: (to) => ({
          name: 'book-detail',
          params: to.params,
          query: { tab: 'files' },
        }),
      },
      {
        path: '/book/:bookId/edit',
        redirect: (to) => ({
          name: 'book-detail',
          params: to.params,
          query: { tab: 'edit' },
        }),
      },
      {
        path: ':pathMatch(.*)*',
        component: () => import('@/views/NotFoundView.vue'),
        meta: { title: () => t('titles.notFound') },
      },
    ],
  },
  {
    path: '/read/:bookId/:fileId',
    name: 'reader',
    component: () => import('@/features/reader/ReaderView.vue'),
    meta: {
      remountOnParamChange: true,
      title: (to) => `${t('titles.readPrefix')} · ${fallbackById('titles.book', numericParam(to, 'bookId'))}`,
    },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/features/auth/LoginPage.vue'),
    meta: { public: true, title: () => t('titles.signIn') },
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/features/auth/RegisterPage.vue'),
    meta: { public: true, title: () => t('titles.register') },
  },
  {
    path: '/setup',
    name: 'setup',
    component: () => import('@/features/auth/SetupPage.vue'),
    meta: { public: true, title: () => t('titles.initialSetup') },
  },
  {
    path: '/forgot-password',
    name: 'forgot-password',
    component: () => import('@/features/auth/ForgotPasswordPage.vue'),
    meta: { public: true, title: () => t('titles.forgotPassword') },
  },
  {
    path: '/reset-password',
    name: 'reset-password',
    component: () => import('@/features/auth/ResetPasswordPage.vue'),
    meta: { public: true, title: () => t('titles.resetPassword') },
  },
  {
    path: '/oauth2-callback',
    name: 'oidc-callback',
    component: () => import('@/features/auth/OidcCallbackPage.vue'),
    meta: { public: true, title: () => t('titles.completingSignIn') },
  },
  {
    path: '/magic',
    name: 'magic-link-login',
    component: () => import('@/features/auth/MagicLinkLoginView.vue'),
    meta: { public: true, title: () => t('titles.magicLinkLogin') },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

registerAuthGuard(router)
registerRouteTitleHook(router)

export default router
