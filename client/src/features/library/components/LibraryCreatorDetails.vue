<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CoverAspectRatio } from '@bookorbit/types'
import AppIcon from '@/components/AppIcon.vue'
import IconPicker from '@/components/IconPicker.vue'

const { t } = useI18n()

const aspectRatioOptions = computed<{ value: CoverAspectRatio; label: string }[]>(() => [
  { value: '2/3', label: t('library.creator.details.coverStyle.portrait') },
  { value: '1/1', label: t('library.creator.details.coverStyle.square') },
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
</script>

<template>
  <div class="px-6 py-6 flex flex-col gap-7 h-full min-h-0">
    <!-- Name row with inline icon preview -->
    <div>
      <label class="block text-[11px] font-semibold uppercase tracking-widest text-foreground/80 mb-3">{{
        t('library.creator.details.libraryName')
      }}</label>
      <div class="flex items-center gap-3">
        <!-- Icon preview -->
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/20">
          <AppIcon :icon="icon || 'Library'" fallback="Library" :size="24" class="text-primary" />
        </div>
        <!-- Name input -->
        <input
          type="text"
          :value="name"
          :placeholder="t('library.creator.details.namePlaceholder')"
          maxlength="255"
          class="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
          @input="emit('update:name', ($event.target as HTMLInputElement).value)"
        />
      </div>
    </div>

    <!-- Cover aspect ratio -->
    <div>
      <div class="flex items-center justify-between mb-1">
        <label class="text-[11px] font-semibold uppercase tracking-widest text-foreground/80">{{
          t('library.creator.details.coverStyle.title')
        }}</label>
        <div class="flex rounded-md border border-border bg-muted/40 p-0.5 gap-0.5">
          <button
            v-for="option in aspectRatioOptions"
            :key="option.value"
            class="px-3 py-1 rounded text-xs font-medium transition-colors"
            :class="
              coverAspectRatio === option.value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            "
            @click="emit('update:coverAspectRatio', option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
      <p class="text-xs text-muted-foreground">{{ t('library.creator.details.coverStyle.hint') }}</p>
    </div>

    <div>
      <label class="block text-[11px] font-semibold uppercase tracking-widest text-foreground/80 mb-3">{{
        t('library.creator.details.icon.label')
      }}</label>
      <IconPicker :model-value="icon ?? ''" :placeholder="t('library.creator.details.icon.placeholder')" @update:model-value="updateIcon" />
      <p v-if="icon" class="mt-2 text-xs text-muted-foreground truncate">
        {{ t('library.creator.details.icon.selected') }} <span class="font-medium text-foreground">{{ icon }}</span>
      </p>
    </div>
  </div>
</template>
