<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Settings2 } from 'lucide-vue-next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import { useAuth } from '@/features/auth/composables/useAuth'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useLibraries } from '@/features/library/composables/useLibraries'
import DashboardScroller from '@/features/dashboard/components/DashboardScroller.vue'
import DashboardSettingsSheet from '@/features/dashboard/components/DashboardSettingsSheet.vue'
import DashboardWelcome from '@/features/dashboard/components/DashboardWelcome.vue'
import { useDashboardConfig } from '@/features/dashboard/composables/useDashboardConfig'

const { user } = useAuth()
const { hasPermission } = usePermissions()
const { libraries, loading: librariesLoading, fetchLibraries } = useLibraries()
const { scrollers } = useDashboardConfig()

const settingsOpen = ref(false)

const enabledScrollers = computed(() => scrollers.value.filter((s) => s.enabled).sort((a, b) => a.order - b.order))

const hasNoLibraries = computed(() => !librariesLoading.value && libraries.value.length === 0)

const greeting = computed(() => {
  const hour = new Date().getHours()
  const base = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = user.value?.name?.split(' ')[0] || user.value?.username
  return firstName ? `${base}, ${firstName}` : base
})

onMounted(() => {
  fetchLibraries()
})
</script>

<template>
  <main class="flex-none">
    <!-- Greeting -->
    <div class="flex items-center justify-between px-1 h-10 pt-4 mr-4 mb-2 sticky top-0 z-20 transition-all duration-300">
      <div class="flex items-center gap-2.5">
        <div class="w-1 h-4 bg-primary/40 rounded-full" />
        <h1 class="text-[17px] font-bold text-foreground/90 tracking-tight">{{ greeting }}</h1>
      </div>
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            @click="settingsOpen = true"
          >
            <Settings2 :size="15" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Customize dashboard</TooltipContent>
      </Tooltip>
    </div>

    <!-- Scrollers / Welcome -->
    <div class="space-y-5 pb-8 pt-2 sm:pr-2">
      <DashboardWelcome v-if="hasNoLibraries" :can-create="hasPermission('manage_libraries')" />
      <template v-else>
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
      </template>
    </div>
  </main>

  <DashboardSettingsSheet v-model:open="settingsOpen" />
</template>
