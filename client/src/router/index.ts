import { createRouter, createWebHistory } from 'vue-router'
import { registerAuthGuard } from './guards/auth.guard'
import HomeView from '@/views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
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
