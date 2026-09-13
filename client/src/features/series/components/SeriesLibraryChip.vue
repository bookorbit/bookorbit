<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * The library a series sits in. A series can span more than one - the same run held as ebooks
 * and as audiobooks - so the extra ones are counted rather than dropped.
 */
const props = withDefaults(defineProps<{ libraryNames: string[]; dotOnly?: boolean }>(), { dotOnly: false })

const { t } = useI18n()

const first = computed(() => props.libraryNames[0] ?? null)
const extra = computed(() => Math.max(0, props.libraryNames.length - 1))

/** A stable hue per library name, so the same library reads the same colour on every row. */
const hue = computed(() => {
  const name = first.value
  if (!name) return 0
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return Math.abs(hash) % 360
})

const title = computed(() => (extra.value > 0 ? props.libraryNames.join(', ') : (first.value ?? '')))
</script>

<template>
  <span
    v-if="first"
    class="inline-flex h-[21px] items-center gap-1.5 rounded-md bg-surface-3 px-1.5 text-[11.5px] font-semibold text-muted-foreground"
    :class="dotOnly ? 'w-[21px] justify-center px-0' : ''"
    :title="title"
  >
    <span class="size-[7px] shrink-0 rounded-full" :style="{ background: `oklch(0.62 0.15 ${hue})` }" />
    <template v-if="!dotOnly">
      <span class="truncate">{{ first }}</span>
      <span v-if="extra > 0" class="shrink-0 tabular-nums">{{ t('series.libraries.more', { count: extra }) }}</span>
    </template>
    <span v-else class="sr-only">{{ title }}</span>
  </span>
</template>
