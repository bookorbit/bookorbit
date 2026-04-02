import { createRouter, createWebHistory, type RouteLocationNormalizedLoaded, type RouteRecordRaw } from 'vue-router'
import { EMAIL_TAB_LABELS, normalizeEmailTab } from '@/features/email/lib/email-tabs'
import { METADATA_TAB_INFO, normalizeMetadataTab } from '@/features/settings/lib/metadata-tabs'
import { READER_TAB_TITLE_LABELS, normalizeReaderTab } from '@/features/settings/lib/reader-tabs'
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
  return Number.isFinite(parsed) ? parsed : null
}

function fallbackById(prefix: string, id: number | null): string {
  return id === null ? prefix : `${prefix} #${id}`
}

function resolveReaderTitle(to: RouteLocationNormalizedLoaded): string {
  const tab = normalizeReaderTab(to.query.tab)
  return READER_TAB_TITLE_LABELS[tab]
}

function resolveEmailTitle(to: RouteLocationNormalizedLoaded): string {
  const tab = normalizeEmailTab(to.query.tab)
  return `${EMAIL_TAB_LABELS[tab]} · Email`
}

function resolveMetadataTitle(to: RouteLocationNormalizedLoaded): string {
  const tab = normalizeMetadataTab(to.query.tab)
  return METADATA_TAB_INFO[tab].titleLabel
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
            component: () => import('@/features/settings/AccountSettings.vue'),
            meta: { title: 'Account' },
          },
          {
            path: 'libraries',
            name: 'settings-libraries',
            component: () => import('@/features/settings/LibrariesSettings.vue'),
            meta: { maxWidth: 'max-w-3xl', title: 'Libraries' },
          },
          {
            path: 'appearance',
            name: 'settings-appearance',
            component: () => import('@/features/settings/AppearanceSettings.vue'),
            meta: { title: 'Appearance' },
          },
          {
            path: 'opds',
            name: 'settings-opds',
            component: () => import('@/features/settings/OpdsSettings.vue'),
            meta: { title: 'OPDS' },
          },
          {
            path: 'kobo',
            name: 'settings-kobo',
            component: () => import('@/features/settings/KoboSettings.vue'),
            meta: { maxWidth: 'max-w-3xl', title: 'Kobo Sync' },
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
            path: 'admin/users',
            name: 'settings-admin-users',
            component: () => import('@/features/admin/UsersPage.vue'),
            meta: { maxWidth: 'max-w-4xl', title: 'Users' },
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
            component: () => import('@/features/settings/OidcSettings.vue'),
            meta: { title: 'OIDC / SSO' },
          },
          {
            path: 'admin/file-naming',
            name: 'settings-admin-file-naming',
            component: () => import('@/features/settings/FileNamingSettings.vue'),
            meta: { maxWidth: 'max-w-6xl', title: 'File Naming' },
          },
          {
            path: 'admin/staging',
            name: 'settings-admin-staging',
            component: () => import('@/features/settings/StagingSettings.vue'),
            meta: { title: 'Staging Settings' },
          },
          {
            path: 'admin/maintenance',
            name: 'settings-admin-maintenance',
            component: () => import('@/features/settings/MaintenanceSettings.vue'),
            meta: { title: 'Maintenance' },
          },
          {
            path: 'admin/audit-log',
            name: 'settings-admin-audit-log',
            component: () => import('@/features/audit/AuditLogPage.vue'),
            meta: { maxWidth: 'max-w-7xl', title: 'Audit Log' },
          },
          { path: ':pathMatch(.*)*', redirect: { name: 'settings-libraries' } },
        ],
      },
      {
        path: '/staging',
        name: 'staging',
        component: () => import('@/views/StagingView.vue'),
        meta: { title: 'Staging' },
      },
      {
        path: '/statistics',
        name: 'statistics',
        component: () => import('@/features/statistics/components/StatisticsPage.vue'),
        meta: { title: 'Statistics' },
      },
      {
        path: '/library/:id',
        name: 'library',
        component: () => import('@/views/HomeView.vue'),
        meta: { title: (to) => fallbackById('Library', numericParam(to, 'id')) },
      },
      {
        path: '/lens/:id',
        name: 'lens',
        component: () => import('@/views/LensView.vue'),
        meta: { title: (to) => fallbackById('Lens', numericParam(to, 'id')) },
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
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

registerAuthGuard(router)
registerRouteTitleHook(router)

export default router
