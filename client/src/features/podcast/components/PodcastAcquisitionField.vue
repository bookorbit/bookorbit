<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PodcastAcquisitionPolicy } from '@bookorbit/types'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'

const policy = defineModel<PodcastAcquisitionPolicy>('policy', { required: true })
const limit = defineModel<number>('limit', { required: true })
const windowDays = defineModel<number>('windowDays', { required: true })
const { t } = useI18n()

const description = computed(() => {
  if (policy.value === 'newest') {
    return t('podcast.acquisition.newestDescription')
  }
  if (policy.value === 'window') {
    return t('podcast.acquisition.windowDescription')
  }
  return t('podcast.acquisition.remoteDescription')
})
</script>

<template>
  <fieldset>
    <legend class="block text-xs font-medium">{{ t('podcast.acquisition.title') }}</legend>
    <Select v-model="policy" :aria-label="t('podcast.acquisition.title')" class="mt-2">
      <option value="remote_only">{{ t('podcast.acquisition.never') }}</option>
      <option value="newest">{{ t('podcast.acquisition.newEpisodes') }}</option>
      <option value="window">{{ t('podcast.acquisition.recentEpisodes') }}</option>
    </Select>
    <p class="mt-2 text-xs leading-5 text-muted-foreground">{{ description }}</p>
    <label v-if="policy === 'newest'" class="mt-3 block text-xs font-medium">
      {{ t('podcast.acquisition.maximumNewest') }}
      <Input v-model.number="limit" type="number" min="1" max="10000" required class="mt-1.5" />
    </label>
    <label v-if="policy === 'window'" class="mt-3 block text-xs font-medium">
      {{ t('podcast.acquisition.publishedWithinDays') }}
      <Input v-model.number="windowDays" type="number" min="1" max="3650" required class="mt-1.5" />
    </label>
  </fieldset>
</template>
