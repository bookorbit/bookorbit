<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ShieldAlert } from '@lucide/vue'
import { api } from '@/lib/api'
import type { ContentFilterRulesWithNames } from '@bookorbit/types'

const { t } = useI18n()

const filters = ref<ContentFilterRulesWithNames | null>(null)
const loading = ref(true)

onMounted(async () => {
  try {
    const res = await api('/api/v1/users/me/content-filters')
    if (res.ok) {
      filters.value = await res.json()
    }
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div v-if="loading" class="settings-loading-state" data-testid="restrictions-loading-state">{{ t('common.loading') }}</div>

  <template v-else-if="filters">
    <div
      v-if="!filters.includeTags?.length && !filters.excludeTags?.length && !filters.includeGenres?.length && !filters.excludeGenres?.length"
      class="settings-empty-state"
      data-testid="restrictions-empty-state"
    >
      <ShieldAlert :size="32" class="mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
      <p class="text-sm font-medium text-foreground">{{ t('settings.account.restrictions.none.title') }}</p>
      <p class="mt-1 text-xs text-muted-foreground">{{ t('settings.account.restrictions.none.description') }}</p>
    </div>

    <div v-else class="space-y-5">
      <div class="flex gap-3 rounded-lg border border-[var(--pill-warning)]/40 bg-[var(--pill-warning)]/10 px-4 py-3 text-[var(--pill-warning)]">
        <ShieldAlert :size="18" class="mt-0.5 shrink-0" aria-hidden="true" />
        <p class="text-sm">
          {{ t('settings.account.restrictions.banner') }}
        </p>
      </div>

      <div class="settings-card" data-testid="restrictions-rules-card">
        <section v-if="filters.includeTags?.length" class="space-y-2 px-4 py-3.5 md:px-5 md:py-4">
          <p class="settings-label">{{ t('settings.account.restrictions.allowedTags.title') }}</p>
          <p class="settings-hint">{{ t('settings.account.restrictions.allowedTags.description') }}</p>
          <div class="flex flex-wrap gap-2 pt-1">
            <span
              v-for="tag in filters.includeTags"
              :key="tag.id"
              class="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
            >
              {{ tag.name }}
            </span>
          </div>
        </section>

        <section v-if="filters.excludeTags?.length" class="space-y-2 px-4 py-3.5 md:px-5 md:py-4">
          <p class="settings-label">{{ t('settings.account.restrictions.blockedTags.title') }}</p>
          <p class="settings-hint">{{ t('settings.account.restrictions.blockedTags.description') }}</p>
          <div class="flex flex-wrap gap-2 pt-1">
            <span
              v-for="tag in filters.excludeTags"
              :key="tag.id"
              class="inline-flex items-center rounded-full bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive"
            >
              {{ tag.name }}
            </span>
          </div>
        </section>

        <section v-if="filters.includeGenres?.length" class="space-y-2 px-4 py-3.5 md:px-5 md:py-4">
          <p class="settings-label">{{ t('settings.account.restrictions.allowedGenres.title') }}</p>
          <p class="settings-hint">{{ t('settings.account.restrictions.allowedGenres.description') }}</p>
          <div class="flex flex-wrap gap-2 pt-1">
            <span
              v-for="genre in filters.includeGenres"
              :key="genre.id"
              class="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
            >
              {{ genre.name }}
            </span>
          </div>
        </section>

        <section v-if="filters.excludeGenres?.length" class="space-y-2 px-4 py-3.5 md:px-5 md:py-4">
          <p class="settings-label">{{ t('settings.account.restrictions.blockedGenres.title') }}</p>
          <p class="settings-hint">{{ t('settings.account.restrictions.blockedGenres.description') }}</p>
          <div class="flex flex-wrap gap-2 pt-1">
            <span
              v-for="genre in filters.excludeGenres"
              :key="genre.id"
              class="inline-flex items-center rounded-full bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive"
            >
              {{ genre.name }}
            </span>
          </div>
        </section>
      </div>
    </div>
  </template>
</template>
