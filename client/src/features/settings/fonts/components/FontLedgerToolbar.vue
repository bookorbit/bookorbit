<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Search, TextCursorInput, X } from '@lucide/vue'
import { formatNumber } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import { PREVIEW_SIZES } from '../lib/preview-sizes'

/** Filter, the preview text and size every specimen follows, and the collection's totals against its cap. */
defineProps<{
  families: number
  files: number
  maxFiles: number
  bytes: number
}>()

const query = defineModel<string>('query', { required: true })
const previewText = defineModel<string>('previewText', { required: true })
const previewSize = defineModel<number>('previewSize', { required: true })

const { t } = useI18n()

function handleQueryInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value
}
function clearQuery() {
  query.value = ''
}
function handlePreviewInput(event: Event) {
  previewText.value = (event.target as HTMLInputElement).value
}
function selectSize(size: number) {
  previewSize.value = size
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2.5">
    <label class="relative block w-full min-w-0 @min-[48rem]:w-60">
      <span class="sr-only">{{ t('settings.admin.serverFonts.filterLabel') }}</span>
      <Search :size="15" class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        type="search"
        class="input-field h-9 w-full ps-9 pe-9"
        :value="query"
        :placeholder="t('settings.admin.serverFonts.filterPlaceholder')"
        @input="handleQueryInput"
      />
      <button
        v-if="query"
        type="button"
        class="absolute end-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="t('settings.admin.serverFonts.filterClear')"
        @click="clearQuery"
      >
        <X :size="14" aria-hidden="true" />
      </button>
    </label>
    <label class="relative block min-w-0 flex-1 @min-[48rem]:max-w-[22.5rem]">
      <span class="sr-only">{{ t('settings.admin.serverFonts.previewLabel') }}</span>
      <TextCursorInput :size="15" class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        type="text"
        class="input-field h-9 w-full ps-9"
        :value="previewText"
        :placeholder="t('settings.admin.serverFonts.previewPlaceholder')"
        @input="handlePreviewInput"
      />
    </label>
    <div
      role="group"
      :aria-label="t('settings.admin.serverFonts.previewSize')"
      class="flex shrink-0 gap-0.5 rounded-lg border border-border bg-muted p-0.5"
    >
      <button
        v-for="(size, index) in PREVIEW_SIZES"
        :key="size"
        type="button"
        class="grid h-[30px] w-[30px] place-items-center rounded-md font-serif leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="previewSize === size ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
        :style="{ fontSize: `${11 + index * 3}px` }"
        :aria-pressed="previewSize === size"
        :aria-label="t('settings.admin.serverFonts.previewSizeOption', { size })"
        :title="t('settings.admin.serverFonts.previewSizeOption', { size })"
        @click="selectSize(size)"
      >
        A
      </button>
    </div>
    <!-- The figures carry the weight; the units stay quiet beside them. -->
    <p
      data-testid="font-totals"
      class="flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px] text-muted-foreground @min-[60rem]:ms-auto @min-[60rem]:w-auto"
    >
      <span
        ><span class="font-semibold text-foreground tabular-nums">{{ formatNumber(families) }}</span>
        {{ t('settings.admin.serverFonts.familiesUnit', { count: families }) }}</span
      >
      <span class="opacity-50" aria-hidden="true">&middot;</span>
      <i18n-t keypath="settings.admin.serverFonts.filesOfMax" tag="span" scope="global">
        <template #count
          ><span class="font-semibold text-foreground tabular-nums">{{ formatNumber(files) }}</span></template
        >
        <template #max>{{ formatNumber(maxFiles) }}</template>
      </i18n-t>
      <span class="opacity-50" aria-hidden="true">&middot;</span>
      <i18n-t keypath="settings.admin.serverFonts.onDisk" tag="span" scope="global">
        <template #size
          ><span class="font-semibold text-foreground tabular-nums">{{ formatBytes(bytes) }}</span></template
        >
      </i18n-t>
    </p>
  </div>
</template>
