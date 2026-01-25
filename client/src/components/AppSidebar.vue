<script setup lang="ts">
import * as Icons from 'lucide-vue-next'
import { Aperture, BookMarked, Clock, BookOpen, Plus, Settings, LogOut, KeyRound } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import { useSettingsDrawer } from '@/composables/useSettingsDrawer'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import { useAuth } from '@/features/auth/composables/useAuth'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useLenses } from '@/features/lens/composables/useLenses'
import CreateLensDialog from '@/features/lens/components/CreateLensDialog.vue'

const { open: openSettings } = useSettingsDrawer()
const { open: openChangePassword } = useChangePasswordDialog()
const { user, logout } = useAuth()
const router = useRouter()
const route = useRoute()
const { libraries, fetchLibraries } = useLibraries()
const { lenses, fetchLenses } = useLenses()

const createLensOpen = ref(false)

const activeLibraryId = computed(() => {
  const id = route.params.id
  return route.name === 'library' && id ? Number(id) : null
})

const activeLensId = computed(() => {
  const id = route.params.id
  return route.name === 'lens' && id ? Number(id) : null
})

function getLibraryIcon(name: string | null | undefined) {
  if (name && name in Icons) return (Icons as Record<string, unknown>)[name]
  return Icons.BookCopy
}

function getLensIcon(name: string | null | undefined) {
  if (name && name in Icons) return (Icons as Record<string, unknown>)[name]
  return Aperture
}

onMounted(() => {
  fetchLibraries()
  fetchLenses()
})
</script>

<template>
  <CreateLensDialog :open="createLensOpen" @close="createLensOpen = false" />

  <Sidebar
    collapsible="icon"
    style="--sidebar-border: color-mix(in oklch, var(--primary) 18%, transparent)"
    class="[&>div:last-child]:shadow-[4px_0_12px_-2px_oklch(0_0_0/0.08)]"
  >
    <SidebarHeader class="border-b border-sidebar-border">
      <div class="flex items-center gap-2.5 px-1 py-1">
        <!-- Logo mark -->
        <div
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-sm"
          style="background: linear-gradient(135deg, var(--primary) 0%, color-mix(in oklch, var(--primary) 75%, transparent) 100%)"
        >
          <svg viewBox="0 0 20 20" fill="none" class="h-4 w-4" aria-hidden="true">
            <path
              d="M5 2.5A1.5 1.5 0 016.5 1h9A1.5 1.5 0 0117 2.5v15a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 015 17.5V2.5z"
              fill="var(--primary-foreground)"
              opacity="0.25"
            />
            <path d="M3 4a1 1 0 011-1h8.5A1.5 1.5 0 0114 4.5V17a1.5 1.5 0 01-1.5 1.5H4a1 1 0 01-1-1V4z" fill="var(--primary-foreground)" />
            <line x1="6" y1="7.5" x2="11.5" y2="7.5" stroke="var(--primary)" stroke-width="1.3" stroke-linecap="round" />
            <line x1="6" y1="10.5" x2="11.5" y2="10.5" stroke="var(--primary)" stroke-width="1.3" stroke-linecap="round" opacity="0.7" />
            <line x1="6" y1="13.5" x2="9.5" y2="13.5" stroke="var(--primary)" stroke-width="1.3" stroke-linecap="round" opacity="0.4" />
          </svg>
        </div>
        <!-- Brand name -->
        <div class="flex flex-col leading-none group-data-[collapsible=icon]:hidden">
          <span class="text-lg font-serif font-semibold text-sidebar-foreground leading-tight tracking-tight">
            Project<span class="text-primary"> X</span>
          </span>
        </div>
      </div>
    </SidebarHeader>

    <SidebarContent>
      <!-- Libraries -->
      <SidebarGroup class="pt-2">
        <SidebarGroupLabel class="text-[10px] uppercase tracking-widest text-sidebar-foreground/35 font-medium group-data-[collapsible=icon]:hidden">
          Libraries
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="lib in libraries" :key="lib.id">
              <SidebarMenuButton
                :is-active="activeLibraryId === lib.id"
                :tooltip="lib.name"
                class="gap-2.5"
                @click="router.push({ name: 'library', params: { id: lib.id } })"
              >
                <component
                  :is="getLibraryIcon(lib.icon)"
                  :size="15"
                  :class="activeLibraryId === lib.id ? 'text-sidebar-primary' : 'text-sidebar-foreground/50'"
                />
                <span :class="activeLibraryId === lib.id ? 'font-medium text-sidebar-foreground' : 'text-sidebar-foreground/70'">
                  {{ lib.name }}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarSeparator class="group-data-[collapsible=icon]:hidden" />

      <!-- Lenses -->
      <SidebarGroup>
        <SidebarGroupLabel class="text-[10px] uppercase tracking-widest text-sidebar-foreground/35 font-medium group-data-[collapsible=icon]:hidden">
          Lenses
        </SidebarGroupLabel>
        <SidebarGroupAction tooltip="New Lens" @click="createLensOpen = true">
          <Plus />
        </SidebarGroupAction>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="lens in lenses" :key="lens.id">
              <SidebarMenuButton
                :is-active="activeLensId === lens.id"
                :tooltip="lens.name"
                class="gap-2.5"
                @click="router.push({ name: 'lens', params: { id: lens.id } })"
              >
                <component
                  :is="getLensIcon(lens.icon)"
                  :size="15"
                  :class="activeLensId === lens.id ? 'text-sidebar-primary' : 'text-sidebar-foreground/50'"
                />
                <span :class="activeLensId === lens.id ? 'font-medium text-sidebar-foreground' : 'text-sidebar-foreground/70'">
                  {{ lens.name }}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem v-if="lenses.length === 0">
              <span class="px-2 py-1 text-xs text-sidebar-foreground/35 group-data-[collapsible=icon]:hidden">No lenses yet</span>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarSeparator class="group-data-[collapsible=icon]:hidden" />

      <!-- Browse -->
      <SidebarGroup>
        <SidebarGroupLabel class="text-[10px] uppercase tracking-widest text-sidebar-foreground/35 font-medium group-data-[collapsible=icon]:hidden">
          Browse
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Reading" class="gap-2.5 opacity-40 cursor-not-allowed">
                <BookOpen :size="15" class="text-sidebar-foreground/50" />
                <span class="text-sidebar-foreground/70">Reading</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Bookmarks" class="gap-2.5 opacity-40 cursor-not-allowed">
                <BookMarked :size="15" class="text-sidebar-foreground/50" />
                <span class="text-sidebar-foreground/70">Bookmarks</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Recently Added" class="gap-2.5 opacity-40 cursor-not-allowed">
                <Clock :size="15" class="text-sidebar-foreground/50" />
                <span class="text-sidebar-foreground/70">Recently Added</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter class="border-t border-sidebar-border">
      <SidebarMenu>
        <!-- User info -->
        <SidebarMenuItem v-if="user">
          <div class="flex items-center gap-2.5 px-2 py-1.5 group-data-[collapsible=icon]:hidden">
            <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-semibold">
              {{ user.name.charAt(0).toUpperCase() }}
            </div>
            <div class="flex flex-col min-w-0 leading-tight">
              <span class="text-xs font-medium text-sidebar-foreground truncate">{{ user.name }}</span>
              <span class="text-[10px] text-sidebar-foreground/40 truncate">{{ user.username }}</span>
            </div>
          </div>
        </SidebarMenuItem>

        <SidebarMenuItem>
          <SidebarMenuButton tooltip="Change Password" class="gap-2.5" @click="openChangePassword()">
            <KeyRound :size="15" class="text-sidebar-foreground/50" />
            <span class="text-sidebar-foreground/70">Change Password</span>
          </SidebarMenuButton>
        </SidebarMenuItem>

        <SidebarMenuItem>
          <SidebarMenuButton tooltip="Settings" class="gap-2.5" @click="openSettings">
            <Settings :size="15" class="text-sidebar-foreground/50" />
            <span class="text-sidebar-foreground/70">Settings</span>
          </SidebarMenuButton>
        </SidebarMenuItem>

        <SidebarMenuItem>
          <SidebarMenuButton tooltip="Sign out" class="gap-2.5" @click="logout">
            <LogOut :size="15" class="text-sidebar-foreground/50" />
            <span class="text-sidebar-foreground/70">Sign out</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>

    <SidebarRail />
  </Sidebar>
</template>
