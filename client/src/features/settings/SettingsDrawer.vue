<script setup lang="ts">
import { ref, shallowRef, watch, computed } from 'vue'
import {
  X,
  ChevronLeft,
  ChevronRight,
  Library,
  ScanLine,
  Paintbrush,
  BookOpen,
  FileText,
  BookImage,
  Info,
  Users,
  ShieldCheck,
  KeyRound,
  LogIn,
} from 'lucide-vue-next'
import { useSettingsDrawer } from '@/composables/useSettingsDrawer'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useThemeStore, BACKGROUND_OPTIONS } from '@/stores/theme'
import LibrariesSettings from './LibrariesSettings.vue'
import ScannerSettings from './ScannerSettings.vue'
import AppearanceSettings from './AppearanceSettings.vue'
import EbookSettings from './EbookSettings.vue'
import PdfSettings from './PdfSettings.vue'
import ComicsSettings from './ComicsSettings.vue'
import AboutSettings from './AboutSettings.vue'
import UsersPage from '@/features/admin/UsersPage.vue'
import RolesPage from '@/features/admin/RolesPage.vue'
import PermissionsPage from '@/features/admin/PermissionsPage.vue'
import OidcSettings from './OidcSettings.vue'

const { isOpen, close } = useSettingsDrawer()
const { isSuperuser, hasPermission, userPermissions } = usePermissions()
const themeStore = useThemeStore()
const bgClass = computed(() => BACKGROUND_OPTIONS.find((o) => o.id === themeStore.background)?.cssClass ?? '')

type SectionId = 'libraries' | 'scanner' | 'appearance' | 'ebook' | 'pdf' | 'comics' | 'about' | 'users' | 'roles' | 'permissions' | 'oidc'

const navGroups = computed(() => {
  const groups = [
    {
      label: 'General',
      items: [
        { id: 'libraries' as SectionId, label: 'Libraries', icon: Library, component: LibrariesSettings },
        { id: 'scanner' as SectionId, label: 'Scanner', icon: ScanLine, component: ScannerSettings },
        { id: 'appearance' as SectionId, label: 'Appearance', icon: Paintbrush, component: AppearanceSettings },
      ],
    },
    {
      label: 'Reader',
      items: [
        { id: 'ebook' as SectionId, label: 'eBook', icon: BookOpen, component: EbookSettings },
        { id: 'pdf' as SectionId, label: 'PDF', icon: FileText, component: PdfSettings },
        { id: 'comics' as SectionId, label: 'Comics', icon: BookImage, component: ComicsSettings },
      ],
    },
    {
      label: 'System',
      items: [{ id: 'about' as SectionId, label: 'About', icon: Info, component: AboutSettings }],
    },
  ]
  // Explicitly reference userPermissions.value so Vue tracks it as a dependency
  const perms = userPermissions.value
  const su = isSuperuser.value
  const adminItems: { id: SectionId; label: string; icon: unknown; component: unknown }[] = []
  if (su || perms.includes('manage_users')) {
    adminItems.push({ id: 'users', label: 'Users', icon: Users, component: UsersPage })
  }
  if (su || perms.includes('manage_roles')) {
    adminItems.push({ id: 'roles', label: 'Roles', icon: ShieldCheck, component: RolesPage })
    adminItems.push({ id: 'permissions', label: 'Permissions', icon: KeyRound, component: PermissionsPage })
  }
  if (su || perms.includes('manage_app_settings')) {
    adminItems.push({ id: 'oidc', label: 'OIDC / SSO', icon: LogIn, component: OidcSettings })
  }
  if (adminItems.length) {
    groups.push({ label: 'Administration', items: adminItems })
  }
  return groups
})

const allItems = computed(() => navGroups.value.flatMap((g) => g.items))
const activeId = ref<SectionId>('libraries')
const activeLabel = ref('Libraries')
const ActiveComponent = shallowRef(LibrariesSettings)
const mobileView = ref<'nav' | 'content'>('nav')

function navigate(id: SectionId) {
  const item = allItems.value.find((i) => i.id === id)!
  activeId.value = id
  activeLabel.value = item.label
  ActiveComponent.value = item.component
  mobileView.value = 'content'
}

watch(isOpen, (v) => {
  if (v) {
    activeId.value = 'libraries'
    activeLabel.value = 'Libraries'
    ActiveComponent.value = LibrariesSettings
    mobileView.value = 'nav'
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer-fade">
      <div v-if="isOpen" class="fixed inset-0 z-50 flex justify-end">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/40 backdrop-blur-[2px]" @click="close" />

        <!-- Panel -->
        <Transition name="drawer-slide">
          <div
            v-if="isOpen"
            class="relative flex h-full w-full md:max-w-[66.666vw] shadow-2xl overflow-hidden bg-background"
            style="border-left: 1px solid var(--border)"
          >
            <!-- ── MOBILE: Nav list ─────────────────────────── -->
            <Transition name="mobile-nav">
              <div v-if="mobileView === 'nav'" class="md:hidden absolute inset-0 flex flex-col bg-background z-10">
                <div class="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
                  <span class="text-base font-semibold text-foreground font-serif">Settings</span>
                  <button
                    class="flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    @click="close"
                  >
                    <X :size="16" />
                  </button>
                </div>
                <div class="flex-1 overflow-y-auto">
                  <div v-for="group in navGroups" :key="group.label" class="mt-6 mb-1">
                    <p class="px-4 pb-1 text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest">
                      {{ group.label }}
                    </p>
                    <button
                      v-for="item in group.items"
                      :key="item.id"
                      class="w-full flex items-center gap-3 px-4 py-3.5 border-b border-border/60 hover:bg-muted/50 active:bg-muted transition-colors"
                      @click="navigate(item.id)"
                    >
                      <div class="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 shrink-0">
                        <component :is="item.icon" :size="15" class="text-primary" />
                      </div>
                      <span class="flex-1 text-sm font-medium text-foreground text-left">{{ item.label }}</span>
                      <ChevronRight :size="15" class="text-muted-foreground/40" />
                    </button>
                  </div>
                  <p class="px-4 py-6 text-[11px] text-muted-foreground/40">projectx · v0.1.0</p>
                </div>
              </div>
            </Transition>

            <!-- ── MOBILE: Content view ─────────────────────── -->
            <Transition name="mobile-content">
              <div v-if="mobileView === 'content'" class="md:hidden absolute inset-0 flex flex-col bg-background z-10">
                <div class="flex items-center gap-1 px-2 h-14 border-b border-border shrink-0">
                  <button
                    class="flex items-center gap-1 px-2 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    @click="mobileView = 'nav'"
                  >
                    <ChevronLeft :size="18" />
                    <span class="text-sm">Settings</span>
                  </button>
                  <span class="flex-1 text-sm font-medium text-foreground text-center pr-16">{{ activeLabel }}</span>
                </div>
                <div class="flex-1 overflow-y-auto" :class="bgClass">
                  <component :is="ActiveComponent" />
                </div>
              </div>
            </Transition>

            <!-- ── DESKTOP: Two-column ─────────────────────── -->
            <nav class="hidden md:flex flex-col w-52 shrink-0 bg-muted/40 border-r border-border h-full">
              <div class="px-4 pt-5 pb-4 border-b border-border flex items-center justify-between">
                <span class="text-sm font-semibold text-foreground font-serif">Settings</span>
                <button
                  class="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  @click="close"
                >
                  <X :size="14" />
                </button>
              </div>
              <div class="flex-1 overflow-y-auto py-3 px-2">
                <div v-for="group in navGroups" :key="group.label" class="mb-4">
                  <p class="px-2 mb-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest">
                    {{ group.label }}
                  </p>
                  <button
                    v-for="item in group.items"
                    :key="item.id"
                    class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors relative"
                    :class="
                      activeId === item.id
                        ? 'bg-background text-foreground font-medium shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                    "
                    @click="navigate(item.id)"
                  >
                    <component :is="item.icon" :size="14" :class="activeId === item.id ? 'text-primary' : 'text-muted-foreground/70'" />
                    {{ item.label }}
                    <div v-if="activeId === item.id" class="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r bg-primary" />
                  </button>
                </div>
              </div>
              <div class="px-4 py-3 border-t border-border">
                <p class="text-[10px] text-muted-foreground/40">projectx · v0.1.0</p>
              </div>
            </nav>

            <main class="hidden md:block flex-1 overflow-y-auto" :class="bgClass">
              <component :is="ActiveComponent" />
            </main>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: opacity 0.2s ease;
}
.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
}

.drawer-slide-enter-active,
.drawer-slide-leave-active {
  transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}
.drawer-slide-enter-from,
.drawer-slide-leave-to {
  transform: translateX(100%);
}

/* Mobile nav → content: nav slides left, content enters from right */
.mobile-nav-leave-active,
.mobile-content-enter-active {
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.mobile-nav-leave-to {
  transform: translateX(-30%);
}
.mobile-content-enter-from {
  transform: translateX(100%);
}

/* Mobile content → nav: content slides right, nav enters from left */
.mobile-content-leave-active,
.mobile-nav-enter-active {
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.mobile-content-leave-to {
  transform: translateX(100%);
}
.mobile-nav-enter-from {
  transform: translateX(-30%);
}
</style>
