<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CoverAspectRatio } from '@bookorbit/types'
import AppIcon from '@/components/AppIcon.vue'
import IconPicker from '@/components/IconPicker.vue'

const { t } = useI18n()

const aspectRatioOptions = computed<{ value: CoverAspectRatio; label: string; swatchClass: string }[]>(() => [
  { value: '2/3', label: t('library.creator.details.coverStyle.portrait'), swatchClass: 'aspect-[2/3]' },
  { value: '1/1', label: t('library.creator.details.coverStyle.square'), swatchClass: 'aspect-square' },
])

defineProps<{
  name: string
  icon: string | null
  coverAspectRatio: CoverAspectRatio
}>()

const emit = defineEmits<{
  'update:name': [value: string]
  'update:icon': [value: string | null]
  'update:coverAspectRatio': [value: CoverAspectRatio]
}>()

function updateIcon(value: string) {
  emit('update:icon', value || null)
}

function updateName(event: Event) {
  emit('update:name', (event.target as HTMLInputElement).value)
}

function updateCoverAspectRatio(event: Event) {
  emit('update:coverAspectRatio', (event.target as HTMLInputElement).value as CoverAspectRatio)
}
</script>

<template>
  <div class="px-6 py-6 flex flex-col gap-7 h-full min-h-0">
    <div>
      <label for="library-name" class="mb-3 block text-[11px] font-semibold uppercase tracking-widest text-foreground/80">
        {{ t('library.creator.details.libraryName') }}
      </label>
      <div class="flex items-center gap-3">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/20">
          <AppIcon :icon="icon || 'Library'" fallback="Library" :size="24" class="text-primary" />
        </div>
        <input
          id="library-name"
          type="text"
          :value="name"
          :placeholder="t('library.creator.details.namePlaceholder')"
          maxlength="255"
          class="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
          autocomplete="off"
          autofocus
          @input="updateName"
        />
      </div>
    </div>

    <div>
      <label class="block text-[11px] font-semibold uppercase tracking-widest text-foreground/80 mb-3">
        {{ t('library.creator.details.icon.label') }}
      </label>
      <IconPicker :model-value="icon ?? ''" :placeholder="t('library.creator.details.icon.placeholder')" @update:model-value="updateIcon" />
    </div>

    <fieldset aria-describedby="cover-style-description">
      <legend class="mb-3 text-[11px] font-semibold uppercase tracking-widest text-foreground/80">
        {{ t('library.creator.details.coverStyle.title') }}
      </legend>
      <div class="flex flex-wrap gap-2">
        <label
          v-for="option in aspectRatioOptions"
          :key="option.value"
          class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
          :class="
            coverAspectRatio === option.value
              ? 'border-primary bg-primary/10 text-foreground ring-1 ring-primary/30'
              : 'border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground'
          "
        >
          <input
            type="radio"
            name="cover-aspect-ratio"
            :value="option.value"
            :checked="coverAspectRatio === option.value"
            class="sr-only"
            @change="updateCoverAspectRatio"
          />
          <span class="h-5 border border-current/70 rounded-sm" :class="option.swatchClass" aria-hidden="true" />
          {{ option.label }}
        </label>
      </div>
      <p id="cover-style-description" class="mt-2 text-xs text-muted-foreground">
        {{ t('library.creator.details.coverStyle.hint') }}
      </p>
    </fieldset>
  </div>
</template>
