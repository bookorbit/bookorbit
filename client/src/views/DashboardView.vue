<script setup lang="ts">
import { computed, ref } from 'vue'
import { Settings2 } from 'lucide-vue-next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import AppHeader from '@/components/AppHeader.vue'
import AppSidebar from '@/components/AppSidebar.vue'
import { useAuth } from '@/features/auth/composables/useAuth'
import { BACKGROUND_OPTIONS, useThemeStore } from '@/stores/theme'
import DashboardScroller from '@/features/dashboard/components/DashboardScroller.vue'
import DashboardSettingsSheet from '@/features/dashboard/components/DashboardSettingsSheet.vue'
import { useDashboardConfig } from '@/features/dashboard/composables/useDashboardConfig'
import { usePermissions } from '@/features/auth/composables/usePermissions'

const { user } = useAuth()
const { scrollers } = useDashboardConfig()
const themeStore = useThemeStore()
const { hasPermission } = usePermissions()

const settingsOpen = ref(false)

const backgroundClass = computed(() => BACKGROUND_OPTIONS.find((b) => b.id === themeStore.background)?.cssClass ?? '')

const enabledScrollers = computed(() => scrollers.value.filter((s) => s.enabled).sort((a, b) => a.order - b.order))

const greeting = computed(() => {
  const hour = new Date().getHours()
  const base = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = user.value?.name?.split(' ')[0] || user.value?.username
  return firstName ? `${base}, ${firstName}` : base
})
</script>

<template>
  <SidebarProvider>
    <AppSidebar />

    <SidebarInset class="flex flex-col min-h-screen glow-wrapper">
      <AppHeader />

      <main class="flex-1 overflow-y-auto" :class="backgroundClass">
        <!-- Greeting -->
        <div class="flex items-center justify-between px-6 pb-4 pt-6">
          <h1 class="text-xl font-semibold tracking-tight">{{ greeting }}</h1>
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                @click="settingsOpen = true"
              >
                <Settings2 :size="16" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Customize dashboard</TooltipContent>
          </Tooltip>
        </div>

        <!-- Scrollers -->
        <div class="space-y-5 px-4 pb-8 sm:px-6">
          <DashboardScroller
            v-for="scroller in enabledScrollers"
            :key="`${scroller.id}-${scroller.type}-${scroller.lensId ?? 0}`"
            :type="scroller.type"
            :title="scroller.label"
            :limit="scroller.limit"
            :lens-id="scroller.lensId"
          />
          <div v-if="enabledScrollers.length === 0" class="px-2 py-12 text-center">
            <p class="text-sm text-muted-foreground">All shelves are hidden.</p>
            <button class="mt-2 text-sm text-primary hover:underline" @click="settingsOpen = true">Customize dashboard</button>
          </div>
        </div>
      </main>
    </SidebarInset>
  </SidebarProvider>

  <DashboardSettingsSheet v-model:open="settingsOpen" />
</template>
