import { createRouter, createWebHistory, type RouteLocationNormalizedLoaded, type RouteRecordRaw } from 'vue-router'
import { normalizeEmailTab } from '@/features/email/lib/email-tabs'
import { normalizeMetadataTab } from '@/features/settings/lib/metadata-tabs'
import { normalizeReaderTab } from '@/features/settings/lib/reader-tabs'
import { ADMIN_TAB_INFO, normalizeAdminTab } from '@/features/settings/lib/admin-tabs'
import { normalizeSystemTab } from '@/features/settings/lib/system-tabs'
import { normalizeAccountTab } from '@/features/settings/lib/account-tabs'
import { normalizeAppearanceTab } from '@/features/settings/lib/appearance-tabs'
import { INTEGRATION_TAB_INFO, normalizeIntegrationTab } from '@/features/settings/lib/integration-tabs'
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

function resolveReaderTitle(to: RouteLocationNormalizedLoaded): string {
  const tab = normalizeReaderTab(to.query.tab)
  return t(`titles.reader.${tab}`)
}

function resolveAppearanceTitle(to: RouteLocationNormalizedLoaded): string {
  const tab = normalizeAppearanceTab(to.query.tab)
  return t(`titles.appearance.${tab}`)
}

function resolveEmailTitle(to: RouteLocationNormalizedLoaded): string {
  const tab = normalizeEmailTab(to.query.tab)
  return `${t(`titles.email.${tab}`)} · ${t('titles.emailSuffix')}`
}

function resolveMetadataTitle(to: RouteLocationNormalizedLoaded): string {
  const tab = normalizeMetadataTab(to.query.tab)
  return t(`titles.metadata.${tab}`)
}

function resolveAdminTitle(to: RouteLocationNormalizedLoaded): string {
  const tab = normalizeAdminTab(to.query.tab)
  return t(ADMIN_TAB_INFO[tab].titleKey)
}

function resolveSystemTitle(to: RouteLocationNormalizedLoaded): string {
  const tab = normalizeSystemTab(to.query.tab)
  return t(`titles.system.${tab}`)
}

function resolveAccountTitle(to: RouteLocationNormalizedLoaded): string {
  const tab = normalizeAccountTab(to.query.tab)
  return t(`titles.account.${tab}`)
}

function resolveIntegrationTitle(to: RouteLocationNormalizedLoaded): string {
  const tab = normalizeIntegrationTab(to.query.tab)
  return INTEGRATION_TAB_INFO[tab].titleLabel
}

function resolveStatisticsTitle(): string {
  return t('titles.statistics')
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
          { path: '', redirect: { name: 'settings-appearance' } },
          {
            path: 'account',
            name: 'settings-account',
            component: () => import('@/features/settings/AccountAllSettings.vue'),
            meta: { title: resolveAccountTitle },
          },
          {
            path: 'notifications',
            name: 'settings-notifications',
            redirect: () => ({ name: 'settings-account', query: { tab: 'notifications' } }),
          },
          {
            path: 'libraries',
            name: 'settings-libraries',
            component: () => import('@/features/settings/LibrariesSettings.vue'),
            meta: { maxWidth: 'max-w-[52rem]', title: () => t('titles.libraries') },
          },
          {
            path: 'appearance',
            name: 'settings-appearance',
            component: () => import('@/features/settings/AppearanceSettings.vue'),
            meta: { title: resolveAppearanceTitle },
          },
          {
            path: 'opds',
            name: 'settings-opds',
            component: () => import('@/features/settings/OpdsSettings.vue'),
            meta: { title: () => t('titles.opds') },
          },
          {
            path: 'integrations',
            name: 'settings-integrations',
            component: () => import('@/features/settings/IntegrationAllSettings.vue'),
            meta: { maxWidth: 'max-w-3xl', title: resolveIntegrationTitle },
            beforeEnter: (to) => {
              const legacyRoute = resolveLegacyIntegrationRoute(to.query.tab)
              return legacyRoute ? { name: legacyRoute } : undefined
            },
          },
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
            path: 'hardcover',
            name: 'settings-hardcover',
            redirect: (to) => ({ name: 'settings-integrations', query: { ...to.query, tab: 'hardcover' } }),
          },
          {
            path: 'readwise',
            name: 'settings-readwise',
            redirect: (to) => ({ name: 'settings-integrations', query: { ...to.query, tab: 'readwise' } }),
          },
          {
            path: 'storygraph',
            name: 'settings-storygraph',
            redirect: (to) => ({ name: 'settings-integrations', query: { ...to.query, tab: 'storygraph' } }),
          },
          {
            path: 'email',
            name: 'settings-email',
            component: () => import('@/features/email/components/EmailSettings.vue'),
            meta: { maxWidth: 'max-w-3xl', title: resolveEmailTitle },
          },
          {
            path: 'reader',
            name: 'settings-reader-general',
            component: () => import('@/features/settings/ReaderAllSettings.vue'),
            meta: { title: resolveReaderTitle },
          },
          {
            path: 'reader/ebook',
            name: 'settings-reader-ebook',
            redirect: { name: 'settings-reader-general', query: { tab: 'ebook' } },
          },
          {
            path: 'reader/pdf',
            name: 'settings-reader-pdf',
            redirect: { name: 'settings-reader-general', query: { tab: 'pdf' } },
          },
          {
            path: 'reader/comics',
            name: 'settings-reader-comics',
            redirect: { name: 'settings-reader-general', query: { tab: 'comics' } },
          },
          {
            path: 'admin',
            name: 'settings-admin',
            component: () => import('@/features/settings/AdminAllSettings.vue'),
            meta: { maxWidth: 'max-w-6xl', title: resolveAdminTitle },
          },
          {
            path: 'admin/users',
            name: 'settings-admin-users',
            redirect: () => ({ name: 'settings-admin', query: { tab: 'users' } }),
          },
          {
            path: 'admin/account-activity/:userId/insights',
            name: 'settings-admin-shared-insights',
            component: () => import('@/features/admin/SharedReadingInsightsPage.vue'),
            props: (route) => ({ userId: Number(route.params.userId) }),
            meta: { maxWidth: 'max-w-6xl', title: resolveAdminTitle },
          },
          {
            path: 'admin/metadata',
            name: 'settings-admin-metadata',
            component: () => import('@/features/settings/MetadataAllSettings.vue'),
            meta: { maxWidth: 'max-w-7xl', title: resolveMetadataTitle },
          },
          {
            path: 'admin/metadata-auto-fetch',
            name: 'settings-admin-metadata-auto-fetch',
            redirect: { name: 'settings-admin-metadata', query: { tab: 'auto-fetch' } },
          },
          {
            path: 'admin/oidc',
            name: 'settings-admin-oidc',
            redirect: () => ({ name: 'settings-admin', query: { tab: 'oidc' } }),
          },
          {
            path: 'system',
            name: 'settings-system',
            component: () => import('@/features/settings/SystemAllSettings.vue'),
            meta: { maxWidth: 'max-w-7xl', title: resolveSystemTitle },
          },
          {
            path: 'admin/file-naming',
            name: 'settings-admin-file-naming',
            redirect: () => ({ name: 'settings-system', query: { tab: 'file-naming' } }),
          },
          {
            path: 'admin/book-dock',
            name: 'settings-admin-book-dock',
            redirect: () => ({ name: 'settings-system', query: { tab: 'book-dock' } }),
          },
          {
            path: 'admin/maintenance',
            name: 'settings-admin-maintenance',
            redirect: () => ({ name: 'settings-system', query: { tab: 'maintenance' } }),
          },
          {
            path: 'admin/audit-log',
            name: 'settings-admin-audit-log',
            redirect: () => ({ name: 'settings-system', query: { tab: 'audit-log' } }),
          },
          {
            path: 'admin/magic-links',
            name: 'settings-admin-magic-links',
            redirect: () => ({ name: 'settings-admin', query: { tab: 'magic-links' } }),
          },
          { path: ':pathMatch(.*)*', redirect: { name: 'settings-libraries' } },
        ],
      },
      {
        path: '/book-dock',
        name: 'book-dock',
        component: () => import('@/views/BookDockView.vue'),
        meta: { title: () => t('titles.bookDock') },
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
        path: '/library/:id',
        name: 'library',
        component: () => import('@/views/HomeView.vue'),
        meta: { title: (to) => fallbackById('titles.library', numericParam(to, 'id')) },
      },
      {
        path: '/smart-scope/:id',
        name: 'smartScope',
        component: () => import('@/views/SmartScopeView.vue'),
        meta: { title: (to) => fallbackById('titles.smartScope', numericParam(to, 'id')) },
      },
      {
        path: '/collection/:id',
        name: 'collection',
        component: () => import('@/views/CollectionView.vue'),
        meta: { title: (to) => fallbackById('titles.collection', numericParam(to, 'id')) },
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
        meta: { title: (to) => fallbackById('titles.author', numericParam(to, 'id')) },
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
        meta: { title: (to) => fallbackById('titles.seriesItem', numericParam(to, 'seriesId')) },
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
          { path: ':pathMatch(.*)*', redirect: { name: 'tools-entity-manager' } },
        ],
      },
      {
        path: '/book/:bookId',
        name: 'book-detail',
        component: () => import('@/views/BookDetailView.vue'),
        meta: { title: (to) => fallbackById('titles.book', numericParam(to, 'bookId')) },
        beforeEnter: (to) => {
          if (!to.query.tab) {
            return { ...to, query: { ...to.query, tab: 'details' } }
          }
        },
      },
      {
        path: '/book/:bookId/files',
        redirect: (to) => ({ name: 'book-detail', params: to.params, query: { tab: 'files' } }),
      },
      {
        path: '/book/:bookId/edit',
        redirect: (to) => ({ name: 'book-detail', params: to.params, query: { tab: 'edit' } }),
      },
      { path: ':pathMatch(.*)*', component: () => import('@/views/NotFoundView.vue'), meta: { title: () => t('titles.notFound') } },
    ],
  },
  {
    path: '/read/:bookId/:fileId',
    name: 'reader',
    component: () => import('@/features/reader/ReaderView.vue'),
    meta: { title: (to) => `${t('titles.readPrefix')} · ${fallbackById('titles.book', numericParam(to, 'bookId'))}` },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/features/auth/LoginPage.vue'),
    meta: { public: true, title: () => t('titles.signIn') },
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
