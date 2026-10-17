<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, CircleCheck, CircleDashed, CircleX, Clock, LoaderCircle, Upload } from '@lucide/vue'
import type { FontScope } from '@bookorbit/types'
import { fontCssFamilyGroupName } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { fontVariantLabel } from '@/features/reader/shared/lib/font-variants'
import { formatBytes } from '@/lib/formatting'
import type { UploadEntry } from '../composables/useFontLibrary'
import { refusalMessageKey } from '../lib/upload-outcome'

/**
 * One card per batch of dropped files, with an answer for each: which family it joined, that it was
 * already on the server, or why it was refused. Replaces a toast per file, which scrolled away before
 * a ten-file family had finished.
 */
const props = withDefaults(defineProps<{ entries: UploadEntry[]; scope?: FontScope }>(), { scope: 'server' })
const emit = defineEmits<{ dismiss: [] }>()

const { t } = useI18n()

const finished = computed(() => props.entries.filter((entry) => entry.state !== 'queued' && entry.state !== 'uploading'))
const busy = computed(() => finished.value.length < props.entries.length)
const counts = computed(() => ({
  added: props.entries.filter((entry) => entry.state === 'added').length,
  duplicate: props.entries.filter((entry) => entry.state === 'duplicate').length,
  refused: props.entries.filter((entry) => entry.state === 'refused' || entry.state === 'failed').length,
}))
const progress = computed(() => (props.entries.length ? (finished.value.length / props.entries.length) * 100 : 0))

const STATE_ICONS = { queued: Clock, uploading: LoaderCircle, added: CircleCheck, duplicate: CircleDashed, refused: CircleX, failed: CircleX }

function iconClass(entry: UploadEntry): string {
  if (entry.state === 'added') return 'text-success'
  if (entry.state === 'refused' || entry.state === 'failed') return 'text-destructive'
  if (entry.state === 'uploading') return 'animate-spin text-primary motion-reduce:animate-none'
  return 'text-muted-foreground'
}

function faceStyle(entry: UploadEntry) {
  if (!entry.face) return {}
  return {
    fontFamily: `'${fontCssFamilyGroupName(entry.face.familyName, props.scope)}', sans-serif`,
    fontWeight: entry.face.weight,
    fontStyle: entry.face.style,
  }
}

function faceLabel(entry: UploadEntry): string {
  if (!entry.face) return ''
  const style = fontVariantLabel({ name: entry.styleName, weight: entry.face.weight, style: entry.face.style }, t)
  return entry.newFamily ? `${style} · ${t('settings.admin.serverFonts.upload.newFamily')}` : style
}

function reason(entry: UploadEntry): string {
  return t(refusalMessageKey(entry.code, props.scope), entry.meta)
}

function handleDismiss() {
  emit('dismiss')
}
</script>

<template>
  <section class="overflow-hidden rounded-xl border border-border bg-card shadow-xs" :aria-label="t('settings.admin.serverFonts.upload.ariaLabel')">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
      <Upload :size="16" class="text-muted-foreground" aria-hidden="true" />
      <span class="text-sm font-semibold">{{ t('settings.admin.serverFonts.upload.title', { count: entries.length }) }}</span>
      <span class="text-[12.5px] text-muted-foreground tabular-nums" aria-live="polite">
        {{ t('settings.admin.serverFonts.upload.progress', { done: finished.length, total: entries.length }) }}
        <template v-if="counts.added"> · {{ t('settings.admin.serverFonts.upload.addedCount', { count: counts.added }) }}</template>
        <template v-if="counts.duplicate"> · {{ t('settings.admin.serverFonts.upload.duplicateCount', { count: counts.duplicate }) }}</template>
        <template v-if="counts.refused"> · {{ t('settings.admin.serverFonts.upload.refusedCount', { count: counts.refused }) }}</template>
      </span>
      <Button variant="ghost" size="sm" type="button" class="ms-auto" :disabled="busy" @click="handleDismiss">
        {{ t('settings.admin.serverFonts.upload.dismiss') }}
      </Button>
    </div>
    <div class="h-[3px] bg-foreground/8" aria-hidden="true">
      <div
        class="h-full rounded-e-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
        :style="{ width: `${progress}%` }"
      />
    </div>
    <ul>
      <li
        v-for="entry in entries"
        :key="entry.id"
        class="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-t border-border/60 px-4 py-2 text-[13px] leading-[19px] md:grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1.15fr)_9rem]"
        data-testid="font-upload-entry"
      >
        <component :is="STATE_ICONS[entry.state]" :size="16" :class="iconClass(entry)" aria-hidden="true" />
        <span class="truncate text-foreground" :title="entry.fileName">{{ entry.fileName }}</span>
        <span class="col-start-2 row-start-2 flex min-w-0 items-center gap-2 text-muted-foreground md:col-start-auto md:row-start-auto">
          <template v-if="entry.face && (entry.state === 'added' || entry.state === 'duplicate')">
            <ChevronRight :size="14" class="shrink-0" aria-hidden="true" />
            <span class="truncate text-base leading-5 text-foreground" :style="faceStyle(entry)">{{ entry.face.familyName }}</span>
            <span class="shrink-0">{{ faceLabel(entry) }}</span>
          </template>
          <span v-else-if="entry.state === 'refused' || entry.state === 'failed'">{{ reason(entry) }}</span>
          <span v-else class="tabular-nums">{{ formatBytes(entry.size) }}</span>
        </span>
        <span
          class="text-end text-[12.5px] whitespace-nowrap"
          :class="{
            'text-success': entry.state === 'added',
            'text-destructive': entry.state === 'refused' || entry.state === 'failed',
            'text-muted-foreground': entry.state === 'queued' || entry.state === 'uploading' || entry.state === 'duplicate',
          }"
        >
          {{ t(`settings.admin.serverFonts.upload.states.${entry.state}`) }}
        </span>
      </li>
    </ul>
  </section>
</template>
