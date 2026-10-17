/// <reference types="vite/client" />

import 'vue-router'
import type { Permission } from '@bookorbit/types'
import type { RouteLocationNormalizedLoaded } from 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean
    requiredPermission?: Permission
    forbiddenPermission?: Permission
    permissionFallback?: string
    maxWidth?: string
    title?: string | ((to: RouteLocationNormalizedLoaded) => string)
    /** The view opens with a PageTitleRow, which carries the phone menu and search buttons itself. */
    titleRow?: boolean
  }
}
