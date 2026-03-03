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
