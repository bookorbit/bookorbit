<script setup lang="ts">
import { ref, shallowRef, watch, computed, onUnmounted } from 'vue'
import type { Component } from 'vue'
import {
  X,
  ChevronLeft,
  ChevronRight,
  Library,
  Paintbrush,
  BookOpen,
  FileText,
  BookImage,
  Settings,
  Info,
  Users,
  LogIn,
  Rss,
  Tablet,
  Wrench,
  FolderPen,
  DatabaseZap,
  PackageOpen,
  Mail,
} from 'lucide-vue-next'
import { useSettingsDrawer } from '@/composables/useSettingsDrawer'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useThemeStore, BACKGROUND_OPTIONS } from '@/stores/theme'
import LibrariesSettings from './LibrariesSettings.vue'
import AppearanceSettings from './AppearanceSettings.vue'
import ReaderSettings from './ReaderSettings.vue'
import EbookSettings from './EbookSettings.vue'
import PdfSettings from './PdfSettings.vue'
import ComicsSettings from './ComicsSettings.vue'
import AboutSettings from './AboutSettings.vue'
import UsersPage from '@/features/admin/UsersPage.vue'
import FileNamingSettings from './FileNamingSettings.vue'
import OidcSettings from './OidcSettings.vue'
import OpdsSettings from './OpdsSettings.vue'
import KoboSettings from './KoboSettings.vue'
import MaintenanceSettings from './MaintenanceSettings.vue'
import MetadataPreferencesSettings from './metadata-preferences/MetadataPreferencesSettings.vue'
import StagingSettings from './StagingSettings.vue'
import EmailSettings from '@/features/email/components/EmailSettings.vue'

const { isOpen, close } = useSettingsDrawer()
const { isSuperuser, userPermissions } = usePermissions()
const themeStore = useThemeStore()
const bgClass = computed(() => BACKGROUND_OPTIONS.find((o) => o.id === themeStore.background)?.cssClass ?? '')

type SectionId =
  | 'libraries'
  | 'appearance'
  | 'opds'
  | 'kobo'
  | 'reader'
  | 'ebook'
  | 'pdf'
  | 'comics'
  | 'about'
  | 'users'
  | 'permissions'
  | 'oidc'
  | 'file-naming'
  | 'maintenance'
  | 'metadata-preferences'
  | 'staging'
  | 'email'

interface NavItem {
  id: SectionId
  label: string
  icon: Component
  component: Component
  maxWidth?: string
}

const navGroups = computed(() => {
  const perms = userPermissions.value
  const su = isSuperuser.value
  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: 'General',
      items: [
        { id: 'libraries' as SectionId, label: 'Libraries', icon: Library, component: LibrariesSettings, maxWidth: 'max-w-3xl' },
        { id: 'appearance' as SectionId, label: 'Appearance', icon: Paintbrush, component: AppearanceSettings },
        ...(su || perms.includes('opds_access') ? [{ id: 'opds' as SectionId, label: 'OPDS', icon: Rss, component: OpdsSettings }] : []),
        ...(su || perms.includes('kobo_sync')
          ? [{ id: 'kobo' as SectionId, label: 'Kobo', icon: Tablet, component: KoboSettings, maxWidth: 'max-w-3xl' }]
          : []),
        ...(su || perms.includes('email_send')
          ? [{ id: 'email' as SectionId, label: 'Email', icon: Mail, component: EmailSettings, maxWidth: 'max-w-3xl' }]
          : []),
      ],
    },
    {
      label: 'Reader',
      items: [
        { id: 'reader' as SectionId, label: 'General', icon: Settings, component: ReaderSettings },
        { id: 'ebook' as SectionId, label: 'eBook', icon: BookOpen, component: EbookSettings },
        { id: 'pdf' as SectionId, label: 'PDF', icon: FileText, component: PdfSettings },
        { id: 'comics' as SectionId, label: 'Comics', icon: BookImage, component: ComicsSettings },
      ],
    },
  ]
  const adminItems: NavItem[] = []
  if (su || perms.includes('manage_users')) {
    adminItems.push({ id: 'users', label: 'Users', icon: Users, component: UsersPage, maxWidth: 'max-w-4xl' })
  }

  if (su || perms.includes('manage_metadata_config')) {
    adminItems.push({
      id: 'metadata-preferences',
      label: 'Metadata',
      icon: DatabaseZap,
      component: MetadataPreferencesSettings,
      maxWidth: 'max-w-5xl',
    })
  }
  if (su || perms.includes('manage_app_settings')) {
    adminItems.push({ id: 'oidc', label: 'OIDC / SSO', icon: LogIn, component: OidcSettings })
    adminItems.push({ id: 'file-naming', label: 'File Naming', icon: FolderPen, component: FileNamingSettings, maxWidth: 'max-w-4xl' })
    adminItems.push({ id: 'staging', label: 'Staging', icon: PackageOpen, component: StagingSettings })
    adminItems.push({ id: 'maintenance', label: 'Maintenance', icon: Wrench, component: MaintenanceSettings })
  }
  if (adminItems.length) {
    groups.push({ label: 'Administration', items: adminItems })
  }
  groups.push({ label: 'System', items: [{ id: 'about' as SectionId, label: 'About', icon: Info, component: AboutSettings }] })
  return groups
})

const allItems = computed(() => navGroups.value.flatMap((g) => g.items))
const activeId = ref<SectionId>('libraries')
const activeLabel = ref('Libraries')
const ActiveComponent = shallowRef<Component>(LibrariesSettings)
const mobileView = ref<'nav' | 'content'>('nav')

const DEFAULT_MAX_WIDTH = 'max-w-2xl'
const activeMaxWidth = computed(() => allItems.value.find((i) => i.id === activeId.value)?.maxWidth ?? DEFAULT_MAX_WIDTH)

function navigate(id: SectionId) {
  const item = allItems.value.find((i) => i.id === id)!
  activeId.value = id
  activeLabel.value = item.label
  ActiveComponent.value = item.component
  mobileView.value = 'content'
}

watch(isOpen, (v) => {
  document.body.style.overflow = v ? 'hidden' : ''
  if (v) {
    activeId.value = 'libraries'
    activeLabel.value = 'Libraries'
    ActiveComponent.value = LibrariesSettings
    mobileView.value = 'nav'
  }
})

onUnmounted(() => {
  document.body.style.overflow = ''
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
            class="relative flex h-full w-full lg:max-w-[85vw] xl:max-w-[75vw] shadow-2xl overflow-hidden bg-background"
            style="border-left: 1px solid var(--border)"
          >
            <!-- ── MOBILE: Nav list (absolute overlay, covers main below) ──── -->
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
                      <span class="flex-1 settings-label text-left">{{ item.label }}</span>
                      <ChevronRight :size="15" class="text-muted-foreground/40" />
                    </button>
                  </div>
                  <p class="px-4 py-6 text-[11px] text-muted-foreground/40">projectx · v0.1.0</p>
                </div>
              </div>
            </Transition>

            <!-- ── DESKTOP: Sidebar nav ───────────────────────────────────── -->
            <nav class="hidden md:flex flex-col w-56 shrink-0 bg-muted/30 border-r border-border h-full">
              <div class="px-4 pt-5 pb-4 border-b border-border flex items-center justify-between">
                <span class="text-sm font-semibold text-foreground tracking-tight">Settings</span>
                <button
                  class="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  @click="close"
                >
                  <X :size="14" />
                </button>
              </div>
              <div class="flex-1 overflow-y-auto py-3 px-2.5">
                <div v-for="group in navGroups" :key="group.label" class="mb-5">
                  <p class="px-2 mb-1.5 text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest">
                    {{ group.label }}
                  </p>
                  <button
                    v-for="item in group.items"
                    :key="item.id"
                    class="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-sm transition-colors"
                    :class="
                      activeId === item.id
                        ? 'bg-primary/10 text-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                    "
                    @click="navigate(item.id)"
                  >
                    <span
                      class="flex items-center justify-center w-6 h-6 rounded-md shrink-0 transition-colors"
                      :class="activeId === item.id ? 'bg-primary/20' : 'bg-muted'"
                    >
                      <component :is="item.icon" :size="14" :class="activeId === item.id ? 'text-primary' : 'text-muted-foreground/90'" />
                    </span>
                    {{ item.label }}
                  </button>
                </div>
              </div>
              <div class="px-4 py-3 border-t border-border">
                <p class="text-[12px] text-muted-foreground/80">projectx · v0.1.0</p>
              </div>
            </nav>

            <!-- ── Shared content (single component mount point) ──────────── -->
            <main class="flex-1 flex flex-col overflow-hidden">
              <!-- Back header: md:hidden keeps it off desktop; on mobile it sits
                   behind the nav overlay when mobileView='nav', visible when 'content' -->
              <div class="md:hidden flex items-center gap-1 px-2 h-14 border-b border-border shrink-0">
                <button
                  class="flex items-center gap-1 px-2 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  @click="mobileView = 'nav'"
                >
                  <ChevronLeft :size="18" />
                  <span class="text-sm">Settings</span>
                </button>
                <span class="flex-1 settings-label text-center pr-16">{{ activeLabel }}</span>
              </div>
              <div class="flex-1 overflow-y-auto" :class="bgClass">
                <div class="px-5 py-6 sm:px-10 sm:py-8 mx-auto" :class="activeMaxWidth">
                  <component :is="ActiveComponent" />
                </div>
              </div>
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

/* Mobile: nav slides left when navigating to content */
.mobile-nav-leave-active {
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.mobile-nav-leave-to {
  transform: translateX(-30%);
}

/* Mobile: nav enters from left when going back */
.mobile-nav-enter-active {
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.mobile-nav-enter-from {
  transform: translateX(-30%);
}
</style>
