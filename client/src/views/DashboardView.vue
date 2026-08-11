<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Loader2, RefreshCw, Settings2, Sparkles } from '@lucide/vue'

import { useAuth } from '@/features/auth/composables/useAuth'
import { getDashboardGreetingLabel } from '@/features/dashboard/lib/greeting'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useLibraries } from '@/features/library/composables/useLibraries'
import DashboardScroller from '@/features/dashboard/components/DashboardScroller.vue'
import DashboardSettingsSheet from '@/features/dashboard/components/DashboardSettingsSheet.vue'
import DashboardWelcome from '@/features/dashboard/components/DashboardWelcome.vue'
import DashboardWidgetRow from '@/features/dashboard/components/DashboardWidgetRow.vue'
import { SHELF_LAYOUT, useDashboardConfig } from '@/features/dashboard/composables/useDashboardConfig'
import { useDashboardLabels } from '@/features/dashboard/composables/useDashboardLabels'
import { useOnboardingTour } from '@/features/onboarding/composables/useOnboardingTour'
import { useSmartScopes } from '@/features/smart-scope/composables/useSmartScopes'

const { t } = useI18n()
const { hasPermission } = usePermissions()
const { user } = useAuth()
const { libraries, loading: librariesLoading, loaded: librariesLoaded, error: librariesError, fetchLibraries } = useLibraries()
const { scrollers, shelfLayout, pruneDeletedSmartScopeScrollers } = useDashboardConfig()
const { shelfTitle } = useDashboardLabels()
const { maybeStartTour } = useOnboardingTour()
const { smartScopes, loaded: smartScopesLoaded, fetchSmartScopes } = useSmartScopes()

const settingsOpen = ref(false)
const now = ref(new Date())
let greetingTimer: number | null = null

const enabledScrollers = computed(() =>
  (Array.isArray(scrollers.value) ? scrollers.value : []).filter((s) => s.enabled).sort((a, b) => a.order - b.order),
)

const shelfLayoutClass = computed(() =>
  shelfLayout.value === SHELF_LAYOUT.TWO_COLUMNS ? 'grid min-w-0 items-start gap-5 xl:grid-cols-2' : 'space-y-5',
)

const libraryState = computed(() => {
  if (librariesLoaded.value) return libraries.value.length === 0 ? 'empty' : 'ready'
  if (librariesError.value) return 'error'
  return 'loading'
})
const greetingText = computed(() => t(`views.dashboard.greeting.${getDashboardGreetingLabel(now.value, user.value?.settings?.timezone)}`))
const greetingName = computed(() => {
  const fullName = user.value?.name?.trim()
  if (fullName) return fullName.split(/\s+/)[0] ?? fullName
  return user.value?.username?.trim() || t('views.dashboard.greeting.fallbackName')
})

watch(
  [smartScopesLoaded, smartScopes],
  ([isLoaded, allSmartScopes]) => {
    if (!isLoaded) return
    pruneDeletedSmartScopeScrollers(allSmartScopes.map((smartScope) => smartScope.id))
  },
  { immediate: true },
)

function handleRetryLibraries() {
  void fetchLibraries()
}

function handleOpenSettings() {
  settingsOpen.value = true
}

onMounted(() => {
  void fetchLibraries()
  void fetchSmartScopes()
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
      <!-- Scrollers / Welcome -->
      <div class="space-y-5 pb-8 pt-4 sm:pr-2">
        <div v-if="libraryState === 'loading'" role="status" class="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 :size="18" class="animate-spin" aria-hidden="true" />
          <span>{{ t('common.loading') }}</span>
        </div>
        <div
          v-else-if="libraryState === 'error'"
          role="alert"
          class="mx-auto flex max-w-md flex-col items-center rounded-2xl border border-destructive/30 bg-card/30 px-8 py-12 text-center shadow-sm"
        >
          <AlertTriangle :size="28" class="mb-4 text-destructive" aria-hidden="true" />
          <h2 class="text-lg font-semibold text-foreground">{{ t('dashboard.libraryLoad.errorTitle') }}</h2>
          <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{{ t('dashboard.libraryLoad.errorDescription') }}</p>
          <button
            type="button"
            class="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="librariesLoading"
            @click="handleRetryLibraries"
          >
            <RefreshCw :size="15" aria-hidden="true" />
            {{ t('common.retry') }}
          </button>
        </div>
        <DashboardWelcome v-else-if="libraryState === 'empty'" :can-create="hasPermission('manage_libraries')" />
        <template v-else>
          <div class="animate-fade-up flex items-center justify-between gap-3 px-1" style="animation-delay: 40ms">
            <div class="flex min-w-0 items-center gap-2">
              <Sparkles :size="16" class="shrink-0 text-primary" />
              <p class="truncate text-[1.05rem] font-medium leading-tight tracking-[-0.01em] text-foreground sm:text-[1.18rem]">
                <span class="text-foreground">{{ greetingText }}</span>
                <span class="ml-1 font-semibold text-primary">{{ greetingName }}</span>
              </p>
            </div>
            <!-- Icon-only below sm so the greeting keeps its width; the label stays available to assistive tech. -->
            <button
              type="button"
              :aria-label="t('views.dashboard.customize')"
              class="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-primary/40 bg-card/40 px-2 py-1.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:border-primary/70 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-2.5"
              @click="handleOpenSettings"
            >
              <Settings2 :size="15" aria-hidden="true" />
              <span class="hidden sm:inline">{{ t('views.dashboard.customize') }}</span>
            </button>
          </div>

          <DashboardWidgetRow class="animate-fade-up" />
          <div v-if="enabledScrollers.length > 0" :class="shelfLayoutClass">
            <DashboardScroller
              v-for="(scroller, index) in enabledScrollers"
              :key="`${scroller.id}-${scroller.type}-${scroller.smartScopeId ?? 0}-${scroller.rows}`"
              :type="scroller.type"
              :title="shelfTitle(scroller)"
              :limit="scroller.limit"
              :rows="scroller.rows"
              :smartScope-id="scroller.smartScopeId"
              class="min-w-0 animate-fade-up"
              :style="{ animationDelay: `${index * 100}ms` }"
            />
          </div>
          <div v-if="enabledScrollers.length === 0" class="px-2 py-12 text-center">
            <p class="text-sm text-muted-foreground">{{ t('views.dashboard.allShelvesHidden') }}</p>
            <button class="mt-2 text-sm text-primary hover:underline" @click="handleOpenSettings">{{ t('views.dashboard.customize') }}</button>
          </div>
        </template>
      </div>
    </main>

    <DashboardSettingsSheet v-model:open="settingsOpen" />
  </div>
</template>
