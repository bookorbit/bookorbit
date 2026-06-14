import { createRouter, createWebHistory, type RouteLocationNormalizedLoaded, type RouteRecordRaw } from 'vue-router'
import { EMAIL_TAB_LABELS, normalizeEmailTab } from '@/features/email/lib/email-tabs'
import { METADATA_TAB_INFO, normalizeMetadataTab } from '@/features/settings/lib/metadata-tabs'
import { READER_TAB_TITLE_LABELS, normalizeReaderTab } from '@/features/settings/lib/reader-tabs'
import { ADMIN_TAB_INFO, normalizeAdminTab } from '@/features/settings/lib/admin-tabs'
import { SYSTEM_TAB_INFO, normalizeSystemTab } from '@/features/settings/lib/system-tabs'
import { ACCOUNT_TAB_INFO, normalizeAccountTab } from '@/features/settings/lib/account-tabs'
import { APPEARANCE_TAB_TITLE_LABELS, normalizeAppearanceTab } from '@/features/settings/lib/appearance-tabs'
import { registerAuthGuard } from './guards/auth.guard'
import { registerRouteTitleHook } from './title-resolver'

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

function fallbackById(prefix: string, id: number | null): string {
  return id === null ? prefix : `${prefix} #${id}`
}

function resolveReaderTitle(to: RouteLocationNormalizedLoaded): string {
  const tab = normalizeReaderTab(to.query.tab)
  return READER_TAB_TITLE_LABELS[tab]
}

function resolveAppearanceTitle(to: RouteLocationNormalizedLoaded): string {
  const tab = normalizeAppearanceTab(to.query.tab)
  return APPEARANCE_TAB_TITLE_LABELS[tab]
}

function resolveEmailTitle(to: RouteLocationNormalizedLoaded): string {
  const tab = normalizeEmailTab(to.query.tab)
  return `${EMAIL_TAB_LABELS[tab]} · Email`
}

function resolveMetadataTitle(to: RouteLocationNormalizedLoaded): string {
  const tab = normalizeMetadataTab(to.query.tab)
  return METADATA_TAB_INFO[tab].titleLabel
}

function resolveAdminTitle(to: RouteLocationNormalizedLoaded): string {
  const tab = normalizeAdminTab(to.query.tab)
  return ADMIN_TAB_INFO[tab].titleLabel
}

function resolveSystemTitle(to: RouteLocationNormalizedLoaded): string {
  const tab = normalizeSystemTab(to.query.tab)
  return SYSTEM_TAB_INFO[tab].titleLabel
}

function resolveAccountTitle(to: RouteLocationNormalizedLoaded): string {
  const tab = normalizeAccountTab(to.query.tab)
  return ACCOUNT_TAB_INFO[tab].titleLabel
}

function resolveStatisticsTitle(): string {
  return 'Statistics'
}

function resolveLegacyIntegrationsRoute(tab: unknown): string {
  switch (firstText(tab)) {
    case 'koreader':
      return 'settings-koreader'
    case 'hardcover':
      return 'settings-hardcover'
    case 'kobo':
    default:
      return 'settings-kobo'
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
        meta: { title: 'Dashboard' },
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
            meta: { maxWidth: 'max-w-[52rem]', title: 'Libraries' },
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
            meta: { title: 'OPDS' },
          },
          {
            path: 'integrations',
            name: 'settings-integrations',
            redirect: (to) => ({ name: resolveLegacyIntegrationsRoute(to.query.tab) }),
          },
          {
            path: 'kobo',
            name: 'settings-kobo',
            component: () => import('@/features/settings/KoboSettings.vue'),
            meta: { maxWidth: 'max-w-4xl', title: 'Kobo Sync' },
          },
          {
            path: 'koreader',
            name: 'settings-koreader',
            component: () => import('@/features/settings/KoreaderSettings.vue'),
            meta: { maxWidth: 'max-w-4xl', title: 'KOReader Sync' },
          },
          {
            path: 'hardcover',
            name: 'settings-hardcover',
            component: () => import('@/features/hardcover/components/HardcoverSettings.vue'),
            meta: { maxWidth: 'max-w-3xl', title: 'Hardcover' },
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
        meta: { title: 'Book Dock' },
      },
      {
        path: '/whats-new',
        name: 'whats-new',
        component: () => import('@/features/whats-new/WhatsNewView.vue'),
        meta: { title: "What's New" },
      },
      {
        path: '/annotations',
        name: 'annotations',
        component: () => import('@/features/annotations/views/AnnotationsHubView.vue'),
        meta: { title: 'Annotations' },
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
        meta: { title: 'Achievements' },
      },
      {
        path: '/library/:id',
        name: 'library',
        component: () => import('@/views/HomeView.vue'),
        meta: { title: (to) => fallbackById('Library', numericParam(to, 'id')) },
      },
      {
        path: '/smart-scope/:id',
        name: 'smartScope',
        component: () => import('@/views/SmartScopeView.vue'),
        meta: { title: (to) => fallbackById('SmartScope', numericParam(to, 'id')) },
      },
      {
        path: '/collection/:id',
        name: 'collection',
        component: () => import('@/views/CollectionView.vue'),
        meta: { title: (to) => fallbackById('Collection', numericParam(to, 'id')) },
      },
      {
        path: '/authors',
        name: 'authors',
        component: () => import('@/features/author/views/AuthorsView.vue'),
        meta: { title: 'Authors' },
      },
      {
        path: '/authors/:id',
        name: 'author-detail',
        component: () => import('@/features/author/views/AuthorDetailView.vue'),
        meta: { title: (to) => fallbackById('Author', numericParam(to, 'id')) },
      },
      {
        path: '/series',
        name: 'series',
        component: () => import('@/features/series/views/SeriesView.vue'),
        meta: { title: 'Series' },
      },
      {
        path: '/series/:seriesId',
        name: 'series-detail',
        component: () => import('@/features/series/views/SeriesDetailView.vue'),
        meta: { title: (to) => fallbackById('Series', numericParam(to, 'seriesId')) },
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
            meta: { title: 'Entity Manager' },
          },
          {
            path: 'bulk-rename',
            name: 'tools-bulk-rename',
            component: () => import('@/features/tools/bulk-rename/views/BulkRenameView.vue'),
            meta: { title: 'Bulk Rename' },
          },
          { path: ':pathMatch(.*)*', redirect: { name: 'tools-entity-manager' } },
        ],
      },
      {
        path: '/book/:bookId',
        name: 'book-detail',
        component: () => import('@/views/BookDetailView.vue'),
        meta: { title: (to) => fallbackById('Book', numericParam(to, 'bookId')) },
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
      { path: ':pathMatch(.*)*', component: () => import('@/views/NotFoundView.vue'), meta: { title: 'Not Found' } },
    ],
  },
  {
    path: '/read/:bookId/:fileId',
    name: 'reader',
    component: () => import('@/features/reader/ReaderView.vue'),
    meta: { title: (to) => `Read · ${fallbackById('Book', numericParam(to, 'bookId'))}` },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/features/auth/LoginPage.vue'),
    meta: { public: true, title: 'Sign In' },
  },
  {
    path: '/setup',
    name: 'setup',
    component: () => import('@/features/auth/SetupPage.vue'),
    meta: { public: true, title: 'Initial Setup' },
  },
  {
    path: '/forgot-password',
    name: 'forgot-password',
    component: () => import('@/features/auth/ForgotPasswordPage.vue'),
    meta: { public: true, title: 'Forgot Password' },
  },
  {
    path: '/reset-password',
    name: 'reset-password',
    component: () => import('@/features/auth/ResetPasswordPage.vue'),
    meta: { public: true, title: 'Reset Password' },
  },
  {
    path: '/oauth2-callback',
    name: 'oidc-callback',
    component: () => import('@/features/auth/OidcCallbackPage.vue'),
    meta: { public: true, title: 'Completing Sign In' },
  },
  {
    path: '/magic',
    name: 'magic-link-login',
    component: () => import('@/features/auth/MagicLinkLoginView.vue'),
    meta: { public: true, title: 'Magic Link Login' },
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
