<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Settings2 } from 'lucide-vue-next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useLibraries } from '@/features/library/composables/useLibraries'
import DashboardScroller from '@/features/dashboard/components/DashboardScroller.vue'
import DashboardSettingsSheet from '@/features/dashboard/components/DashboardSettingsSheet.vue'
import DashboardWelcome from '@/features/dashboard/components/DashboardWelcome.vue'
import { useDashboardConfig } from '@/features/dashboard/composables/useDashboardConfig'

const { hasPermission } = usePermissions()
const { libraries, loading: librariesLoading, fetchLibraries } = useLibraries()
const { scrollers } = useDashboardConfig()

const settingsOpen = ref(false)

const enabledScrollers = computed(() => scrollers.value.filter((s) => s.enabled).sort((a, b) => a.order - b.order))

const hasNoLibraries = computed(() => !librariesLoading.value && libraries.value.length === 0)

onMounted(() => {
  fetchLibraries()
})
</script>

<template>
  <main class="relative flex-none">
    <!-- Floating Settings Button -->
    <div class="pointer-events-none fixed bottom-6 right-6 z-50">
      <div class="pointer-events-auto transition-all duration-300">
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              class="flex h-11 w-11 items-center justify-center rounded-full border-2 border-primary/40 bg-background/90 text-primary shadow-2xl backdrop-blur-md transition-all hover:bg-primary hover:text-primary-foreground active:scale-95"
              @click="settingsOpen = true"
            >
              <Settings2 :size="18" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" align="center">Customize dashboard</TooltipContent>
        </Tooltip>
      </div>
    </div>

    <!-- Scrollers / Welcome -->
    <div class="space-y-5 pb-8 pt-4 sm:pr-2">
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
