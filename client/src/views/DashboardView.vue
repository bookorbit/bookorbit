<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Settings2, Sparkles } from '@lucide/vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import { useAuth } from '@/features/auth/composables/useAuth'
import { getDashboardGreetingLabel } from '@/features/dashboard/lib/greeting'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useLibraries } from '@/features/library/composables/useLibraries'
import DashboardScroller from '@/features/dashboard/components/DashboardScroller.vue'
import DashboardSettingsSheet from '@/features/dashboard/components/DashboardSettingsSheet.vue'
import DashboardWelcome from '@/features/dashboard/components/DashboardWelcome.vue'
import DashboardWidgetRow from '@/features/dashboard/components/DashboardWidgetRow.vue'
import { useDashboardConfig } from '@/features/dashboard/composables/useDashboardConfig'
import { useOnboardingTour } from '@/features/onboarding/composables/useOnboardingTour'
import { useSmartScopes } from '@/features/smart-scope/composables/useSmartScopes'

const { hasPermission } = usePermissions()
const { user } = useAuth()
const { libraries, loading: librariesLoading, fetchLibraries } = useLibraries()
const { scrollers, pruneDeletedSmartScopeScrollers } = useDashboardConfig()
const { maybeStartTour } = useOnboardingTour()
const { smartScopes, loaded: smartScopesLoaded, fetchSmartScopes } = useSmartScopes()

const settingsOpen = ref(false)
const now = ref(new Date())
let greetingTimer: number | null = null

const enabledScrollers = computed(() =>
  (Array.isArray(scrollers.value) ? scrollers.value : []).filter((s) => s.enabled).sort((a, b) => a.order - b.order),
)

const hasNoLibraries = computed(() => !librariesLoading.value && libraries.value.length === 0)
const greetingLabel = computed(() => {
  return getDashboardGreetingLabel(now.value, user.value?.settings?.timezone)
})
const greetingName = computed(() => {
  const fullName = user.value?.name?.trim()
  if (fullName) return fullName.split(/\s+/)[0] ?? fullName
  return user.value?.username?.trim() || 'there'
})

watch(
  [smartScopesLoaded, smartScopes],
  ([isLoaded, allSmartScopes]) => {
    if (!isLoaded) return
    pruneDeletedSmartScopeScrollers(allSmartScopes.map((smartScope) => smartScope.id))
  },
  { immediate: true },
)

onMounted(() => {
  fetchLibraries()
  fetchSmartScopes()
  greetingTimer = window.setInterval(() => {
    now.value = new Date()
  }, 60_000)
  nextTick(() => {
    setTimeout(maybeStartTour, 500)
  })
})

onUnmounted(() => {
  if (greetingTimer !== null) {
    window.clearInterval(greetingTimer)
    greetingTimer = null
  }
})
</script>

<template>
  <div>
    <main class="relative flex-none">
      <!-- Floating Settings Button -->
      <div class="pointer-events-none fixed bottom-6 right-6 z-50">
        <div
          class="pointer-events-auto animate-fade-up"
          style="animation-delay: 400ms; animation-duration: 0.3s; animation-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1)"
        >
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
          <div class="animate-fade-up flex items-center gap-2 px-1" style="animation-delay: 40ms">
            <Sparkles :size="16" class="shrink-0 text-primary/85" />
            <p class="text-[1.05rem] font-medium leading-tight tracking-[-0.01em] text-foreground/90 sm:text-[1.18rem]">
              <span class="text-foreground/88">Good {{ greetingLabel }},</span>
              <span class="ml-1 font-semibold text-primary">{{ greetingName }}</span>
            </p>
          </div>

          <DashboardWidgetRow class="animate-fade-up" />
          <DashboardScroller
            v-for="(scroller, index) in enabledScrollers"
            :key="`${scroller.id}-${scroller.type}-${scroller.smartScopeId ?? 0}`"
            :type="scroller.type"
            :title="scroller.label"
            :limit="scroller.limit"
            :smartScope-id="scroller.smartScopeId"
            class="animate-fade-up"
            :style="{ animationDelay: `${index * 100}ms` }"
          />
          <div v-if="enabledScrollers.length === 0" class="px-2 py-12 text-center">
            <p class="text-sm text-muted-foreground">All shelves are hidden.</p>
            <button class="mt-2 text-sm text-primary hover:underline" @click="settingsOpen = true">Customize dashboard</button>
          </div>
        </template>
      </div>
    </main>

    <DashboardSettingsSheet v-model:open="settingsOpen" />
  </div>
</template>
