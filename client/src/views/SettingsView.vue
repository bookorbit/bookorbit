<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { ChevronRight } from '@lucide/vue'
import { findSettingsNavItem } from '@/features/settings/lib/settings-nav'

const { t } = useI18n()
const route = useRoute()

const contentScroll = ref<HTMLElement | null>(null)

const maxWidth = computed(() => (route.meta.maxWidth as string | undefined) ?? 'max-w-3xl')
const match = computed(() => findSettingsNavItem(typeof route.name === 'string' ? route.name : ''))
const pageTitle = computed(() => (match.value ? t(match.value.item.labelKey) : t('settings.nav.title')))

const breadcrumb = computed(() => {
  if (!match.value) return []
  const trail = [t('settings.nav.title'), t(match.value.group.labelKey)]
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
  <div class="flex h-full flex-col overflow-hidden rounded-lg border border-border/70 bg-card/40 shadow-sm">
    <div class="shrink-0 border-b border-border/70 bg-card/60 px-4 py-2.5 md:px-6" data-testid="settings-page-header">
      <div class="flex min-h-9 items-center gap-4">
        <div class="flex min-w-0 flex-1 items-baseline gap-2">
          <!-- The trail gives way before the title does; phones keep only the nearest crumb. -->
          <nav v-if="breadcrumb.length" :aria-label="t('settings.nav.breadcrumbLabel')" class="min-w-0 shrink-[999]">
            <ol class="flex min-w-0 items-baseline gap-2">
              <li
                v-for="(crumb, index) in breadcrumb"
                :key="crumb"
                class="flex min-w-0 items-baseline gap-2"
                :class="{ 'max-sm:hidden': index < breadcrumb.length - 1 }"
                data-testid="settings-breadcrumb-item"
              >
                <span class="truncate text-sm text-muted-foreground">{{ crumb }}</span>
                <ChevronRight :size="14" class="shrink-0 self-center text-muted-foreground rtl:rotate-180" aria-hidden="true" />
              </li>
            </ol>
          </nav>
          <h2 class="min-w-0 truncate font-serif text-lg font-semibold tracking-tight text-foreground" data-testid="settings-page-title">
            {{ pageTitle }}
          </h2>
        </div>
        <!-- Pages teleport their primary action here so it sits beside the title
             instead of being wedged into the page body. -->
        <div id="settings-header-actions" class="flex shrink-0 items-center gap-2" />
      </div>
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
