<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { File, Folder, FolderOpen, TriangleAlert } from '@lucide/vue'
import { firstToken, splitExtension, type ResolvedLevel, type ResolvedPreview } from '../lib/pattern-resolution'

const props = defineProps<{
  preview: ResolvedPreview
  extension: string
  label: string
}>()

const { t } = useI18n()

interface Row {
  level: ResolvedLevel
  depth: number
  stem: string
  suffix: string
  token: string
}

// Depth stops growing past five folders so a deep scheme cannot push names off a phone screen.
const MAX_DEPTH = 5

const rows = computed<Row[]>(() => {
  let depth = 0
  return props.preview.levels.map((level) => {
    const row: Row = {
      level,
      depth: Math.min(depth, MAX_DEPTH),
      stem: level.name,
      suffix: '',
      token: firstToken(level.text) ?? '',
    }
    if (level.kind === 'file') [row.stem, row.suffix] = splitExtension(level.name, props.extension)
    if (level.kind !== 'file' && (!level.skipped || level.emptyName)) depth += 1
    return row
  })
})

const tokenText = (token: string) => `{${token}}`

function iconFor(level: ResolvedLevel) {
  if (level.kind === 'file') return File
  return level.bookFolder ? FolderOpen : Folder
}
</script>

<template>
  <div v-if="!preview.path" class="flex items-center gap-2 text-xs text-muted-foreground">
    <TriangleAlert :size="14" class="shrink-0 text-warning" aria-hidden="true" />
    {{ t('settings.reader.fileNaming.previewEmpty') }}
  </div>

  <ol v-else class="list-none p-0" :aria-label="label">
    <li
      v-for="(row, index) in rows"
      :key="index"
      class="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-2.5 py-0.5 text-sm leading-[1.375rem]"
      :style="{ paddingInlineStart: `${row.depth * 1.125}rem` }"
    >
      <template v-if="row.level.emptyName">
        <TriangleAlert :size="14" class="mt-1 text-destructive" aria-hidden="true" />
        <span class="text-[13px] text-destructive">{{ t('settings.reader.fileNaming.levelEmptyName') }}</span>
      </template>

      <template v-else-if="row.level.skipped">
        <Folder :size="14" class="folder-dashed mt-1 text-muted-foreground" aria-hidden="true" />
        <i18n-t keypath="settings.reader.fileNaming.levelSkipped" tag="span" class="text-[13px] text-muted-foreground" scope="global">
          <template #token
            ><span class="font-mono text-xs">{{ tokenText(row.token) }}</span></template
          >
        </i18n-t>
      </template>

      <template v-else>
        <component
          :is="iconFor(row.level)"
          :size="14"
          class="mt-1"
          :class="[
            row.level.kind === 'file' || row.level.bookFolder ? 'text-primary' : 'text-muted-foreground',
            row.level.kind === 'optional' ? 'folder-dashed' : '',
          ]"
          aria-hidden="true"
        />
        <span
          class="min-w-0 break-words"
          :class="[row.level.kind === 'file' ? 'font-semibold' : '', row.level.usedFallback ? 'text-pattern-fallback' : 'text-foreground']"
          >{{ row.stem }}<span v-if="row.suffix" class="font-medium text-primary">{{ row.suffix }}</span>
          <span v-if="row.level.usedFallback" class="tag tag-fallback">{{ t('settings.reader.fileNaming.tagFallback') }}</span>
          <span v-if="row.level.bookFolder" class="tag">{{ t('settings.reader.fileNaming.tagBookFolder') }}</span>
          <span v-if="row.level.keepsUploadName" class="tag">{{ t('settings.reader.fileNaming.tagUploadedName') }}</span>
          <span v-if="row.level.truncated" class="tag tag-warning">{{ t('settings.reader.fileNaming.tagShortened') }}</span>
        </span>
      </template>
    </li>
  </ol>
</template>

<style scoped>
.folder-dashed :deep(path) {
  stroke-dasharray: 2.6 2.4;
}

.tag {
  display: inline-flex;
  margin-inline-start: 0.375rem;
  vertical-align: 1px;
  border-radius: 0.25rem;
  padding: 0 0.3125rem;
  font-family: var(--font-sans);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  line-height: 1rem;
  text-transform: uppercase;
  white-space: nowrap;
  color: var(--muted-foreground);
  background: color-mix(in oklch, var(--foreground) 8%, transparent);
}

.tag-fallback {
  color: var(--pattern-fallback);
  background: color-mix(in oklch, var(--pattern-fallback) 14%, transparent);
}

.tag-warning {
  color: var(--warning);
  background: color-mix(in oklch, var(--warning) 14%, transparent);
}
</style>
