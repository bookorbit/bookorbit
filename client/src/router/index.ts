import { createRouter, createWebHistory } from 'vue-router'
import { registerAuthGuard } from './guards/auth.guard'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: () => import('@/components/AppLayout.vue'),
      children: [
        {
          path: '',
          name: 'dashboard',
          component: () => import('@/views/DashboardView.vue'),
        },
        {
          path: '/settings',
          component: () => import('@/views/SettingsView.vue'),
          children: [
            { path: '', redirect: { name: 'settings-libraries' } },
            {
              path: 'libraries',
              name: 'settings-libraries',
              component: () => import('@/features/settings/LibrariesSettings.vue'),
              meta: { maxWidth: 'max-w-3xl' },
            },
            {
              path: 'appearance',
              name: 'settings-appearance',
              component: () => import('@/features/settings/AppearanceSettings.vue'),
            },
            {
              path: 'opds',
              name: 'settings-opds',
              component: () => import('@/features/settings/OpdsSettings.vue'),
            },
            {
              path: 'kobo',
              name: 'settings-kobo',
              component: () => import('@/features/settings/KoboSettings.vue'),
              meta: { maxWidth: 'max-w-3xl' },
            },
            {
              path: 'email',
              name: 'settings-email',
              component: () => import('@/features/email/components/EmailSettings.vue'),
              meta: { maxWidth: 'max-w-3xl' },
            },
            {
              path: 'reader',
              name: 'settings-reader-general',
              component: () => import('@/features/settings/ReaderSettings.vue'),
            },
            {
              path: 'reader/ebook',
              name: 'settings-reader-ebook',
              component: () => import('@/features/settings/EbookSettings.vue'),
            },
            {
              path: 'reader/pdf',
              name: 'settings-reader-pdf',
              component: () => import('@/features/settings/PdfSettings.vue'),
            },
            {
              path: 'reader/comics',
              name: 'settings-reader-comics',
              component: () => import('@/features/settings/ComicsSettings.vue'),
            },
            {
              path: 'admin/users',
              name: 'settings-admin-users',
              component: () => import('@/features/admin/UsersPage.vue'),
              meta: { maxWidth: 'max-w-4xl' },
            },
            {
              path: 'admin/metadata',
              name: 'settings-admin-metadata',
              component: () => import('@/features/settings/metadata-preferences/MetadataPreferencesSettings.vue'),
              meta: { maxWidth: 'max-w-5xl' },
            },
            {
              path: 'admin/oidc',
              name: 'settings-admin-oidc',
              component: () => import('@/features/settings/OidcSettings.vue'),
            },
            {
              path: 'admin/file-naming',
              name: 'settings-admin-file-naming',
              component: () => import('@/features/settings/FileNamingSettings.vue'),
              meta: { maxWidth: 'max-w-4xl' },
            },
            {
              path: 'admin/staging',
              name: 'settings-admin-staging',
              component: () => import('@/features/settings/StagingSettings.vue'),
            },
            {
              path: 'admin/maintenance',
              name: 'settings-admin-maintenance',
              component: () => import('@/features/settings/MaintenanceSettings.vue'),
            },
            {
              path: 'about',
              name: 'settings-about',
              component: () => import('@/features/settings/AboutSettings.vue'),
            },
          ],
        },
        {
          path: '/staging',
          name: 'staging',
          component: () => import('@/views/StagingView.vue'),
        },
        {
          path: '/library/:id',
          name: 'library',
          component: () => import('@/views/HomeView.vue'),
        },
        {
          path: '/lens/:id',
          name: 'lens',
          component: () => import('@/views/LensView.vue'),
        },
        {
          path: '/collection/:id',
          name: 'collection',
          component: () => import('@/views/CollectionView.vue'),
        },
        {
          path: '/authors',
          name: 'authors',
          component: () => import('@/features/author/views/AuthorsView.vue'),
        },
        {
          path: '/authors/:id',
          name: 'author-detail',
          component: () => import('@/features/author/views/AuthorDetailView.vue'),
        },
        {
          path: '/book/:bookId',
          name: 'book-detail',
          component: () => import('@/views/BookDetailView.vue'),
        },
        {
          path: '/book/:bookId/files',
          name: 'book-files',
          component: () => import('@/views/BookFilesView.vue'),
        },
        {
          path: '/book/:bookId/edit',
          name: 'book-edit',
          component: () => import('@/views/BookEditMetadataView.vue'),
        },
      ],
    },
    {
      path: '/read/:bookId/:fileId',
      name: 'reader',
      component: () => import('@/features/reader/ReaderView.vue'),
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/features/auth/LoginPage.vue'),
      meta: { public: true },
    },
    {
      path: '/setup',
      name: 'setup',
      component: () => import('@/features/auth/SetupPage.vue'),
      meta: { public: true },
    },
    {
      path: '/forgot-password',
      name: 'forgot-password',
      component: () => import('@/features/auth/ForgotPasswordPage.vue'),
      meta: { public: true },
    },
    {
      path: '/reset-password',
      name: 'reset-password',
      component: () => import('@/features/auth/ResetPasswordPage.vue'),
      meta: { public: true },
    },
    {
      path: '/oauth2-callback',
      name: 'oidc-callback',
      component: () => import('@/features/auth/OidcCallbackPage.vue'),
      meta: { public: true },
    },
  ],
})

registerAuthGuard(router)

export default router
