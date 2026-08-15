<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { ChevronRight } from '@lucide/vue'
import SettingsPageHeader from '@/features/settings/SettingsPageHeader.vue'
import { findSettingsNavItem } from '@/features/settings/lib/settings-nav'

const { t } = useI18n()
const route = useRoute()

const contentScroll = ref<HTMLElement | null>(null)

const maxWidth = computed(() => (route.meta.maxWidth as string | undefined) ?? 'max-w-3xl')
const match = computed(() => findSettingsNavItem(typeof route.name === 'string' ? route.name : ''))
const pageTitle = computed(() => (match.value ? t(match.value.item.labelKey) : t('settings.nav.title')))
const pageDescription = computed(() => (match.value?.item.descriptionKey ? t(match.value.item.descriptionKey) : ''))

const breadcrumb = computed(() => {
  if (!match.value) return []
  const trail = [t(match.value.group.labelKey)]
  if (match.value.parent) trail.push(t(match.value.parent.labelKey))
  return trail
})

watch(
  () => route.name,
  () => {
    if (contentScroll.value) contentScroll.value.scrollTop = 0
  },
)
</script>

<template>
  <div class="mt-2 flex h-[calc(100%-0.5rem)] flex-col overflow-hidden rounded-lg border border-border/70 bg-card/40 shadow-sm">
    <div class="shrink-0 border-b border-border/70 bg-card/60 px-4 py-3 md:px-6" data-testid="settings-page-header">
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{{ t('settings.nav.title') }}</span>
        <template v-for="crumb in breadcrumb" :key="crumb">
          <ChevronRight :size="13" class="opacity-60" aria-hidden="true" />
          <span class="truncate">{{ crumb }}</span>
        </template>
      </div>
      <SettingsPageHeader v-if="match" class="mb-0! mt-2" :title="pageTitle" :subtitle="pageDescription" />
    </div>

    <div ref="contentScroll" class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
      <div data-testid="settings-page-content" class="px-4 pb-6 pt-4 md:px-6 md:pt-5" :class="maxWidth">
        <router-view v-slot="{ Component, route: childRoute }">
          <div :key="childRoute.path">
            <component :is="Component" />
          </div>
        </router-view>
      </div>
    </div>
  </div>
</template>
