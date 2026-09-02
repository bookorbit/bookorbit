<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AudioLines, BookOpen, Images, Loader2 } from '@lucide/vue'
import type { ReleaseUnitChoice } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { formatBytes } from '@/lib/formatting'

const props = defineProps<{
  units: ReleaseUnitChoice[]
  busy: boolean
}>()

const emit = defineEmits<{ choose: [number] }>()

const { t } = useI18n()

/** Nothing is preselected: the whole point is that BookOrbit could not tell which one was wanted. */
const selected = ref<number | null>(null)

const UNIT_ICONS = { ebook: BookOpen, audiobook: AudioLines, comic: Images } as const

function unitLabel(unit: ReleaseUnitChoice): string {
  return unit.title ?? t('bookRequests.chooser.untitled')
}

function unitDetail(unit: ReleaseUnitChoice): string {
  const parts = [t(`bookRequests.chooser.mediaKind.${unit.mediaKind}`), t('bookRequests.chooser.files', { count: unit.contentFileCount })]
  if (unit.sizeBytes !== null) parts.push(formatBytes(unit.sizeBytes))
  return parts.join(' · ')
}

function handleImport() {
  if (selected.value !== null) emit('choose', selected.value)
}
</script>

<template>
  <section class="rounded-lg border border-border bg-card p-4" :aria-label="t('bookRequests.chooser.title')">
    <h3 class="text-sm font-semibold text-foreground">{{ t('bookRequests.chooser.title') }}</h3>
    <p class="mt-1 text-xs text-muted-foreground">{{ t('bookRequests.chooser.hint', { count: props.units.length }) }}</p>

    <fieldset class="mt-3" :disabled="props.busy">
      <legend class="sr-only">{{ t('bookRequests.chooser.title') }}</legend>

      <div class="grid gap-1.5">
        <label
          v-for="unit in props.units"
          :key="unit.index"
          class="flex items-start gap-2.5 rounded-md border border-border p-2.5 transition-colors hover:border-primary/50"
          :class="selected === unit.index ? 'border-primary bg-primary/5' : ''"
        >
          <input v-model="selected" type="radio" name="release-unit" class="mt-1 accent-primary" :value="unit.index" />
          <component :is="UNIT_ICONS[unit.mediaKind]" class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span class="min-w-0 flex-1">
            <span class="block break-words text-sm text-foreground">{{ unitLabel(unit) }}</span>
            <span class="block text-xs text-muted-foreground">{{ unitDetail(unit) }}</span>
          </span>
        </label>
      </div>
    </fieldset>

    <Button class="mt-3" :disabled="selected === null || props.busy" @click="handleImport">
      <Loader2 v-if="props.busy" class="size-4 animate-spin" aria-hidden="true" />
      {{ t('bookRequests.chooser.import') }}
    </Button>
  </section>
</template>
