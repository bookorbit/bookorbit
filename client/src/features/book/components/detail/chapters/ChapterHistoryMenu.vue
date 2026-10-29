<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { History, Loader2, RotateCcw } from '@lucide/vue'
import type { AudiobookChapterSource, BookChapterVersionSummary } from '@bookorbit/types'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { formatRelativeTimeFromNow } from '@/i18n/formatters'

defineProps<{
  versions: BookChapterVersionSummary[] | null
  loading: boolean
  reverting: boolean
}>()

const emit = defineEmits<{ open: [versionId: number]; revert: [] }>()

const { t } = useI18n()

const SOURCE_KEYS: Record<AudiobookChapterSource, string> = {
  embedded: 'book.detail.chapters.history.source.embedded',
  tracks: 'book.detail.chapters.history.source.tracks',
  provider: 'book.detail.chapters.history.source.provider',
  migration: 'book.detail.chapters.history.source.migration',
  manual: 'book.detail.chapters.history.source.manual',
}

function describe(version: BookChapterVersionSummary): string {
  const source = t(SOURCE_KEYS[version.source])
  return version.createdBy ? t('book.detail.chapters.history.by', { source, name: version.createdBy.name }) : source
}

function handleOpen(event: Event) {
  const id = Number((event.currentTarget as HTMLElement).dataset.version)
  if (Number.isFinite(id)) emit('open', id)
}

function handleRevert() {
  emit('revert')
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <slot />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-72">
      <DropdownMenuItem v-if="loading && !versions" disabled>
        <Loader2 class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {{ t('book.detail.chapters.history.heading') }}
      </DropdownMenuItem>
      <DropdownMenuItem v-else-if="!versions || versions.length === 0" disabled>
        {{ t('book.detail.chapters.history.empty') }}
      </DropdownMenuItem>
      <DropdownMenuItem
        v-for="version in versions ?? []"
        :key="version.id"
        :data-version="version.id"
        class="items-start gap-2.5 py-2"
        @click="handleOpen"
      >
        <History class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[13px] leading-tight">{{ describe(version) }}</span>
          <span class="mt-1 block text-[11.5px] leading-none text-muted-foreground tabular-nums">
            {{ t('book.detail.chapters.history.facts', { when: formatRelativeTimeFromNow(version.createdAt), count: version.chapterCount }) }}
          </span>
        </span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem :disabled="reverting" @click="handleRevert">
        <Loader2 v-if="reverting" class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <RotateCcw v-else class="size-3.5" aria-hidden="true" />
        {{ t('book.detail.chapters.revert.action') }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
