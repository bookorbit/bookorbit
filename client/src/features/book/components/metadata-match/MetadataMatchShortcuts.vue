<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Keyboard } from '@lucide/vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const { t } = useI18n()

const SHORTCUTS = [
  { keys: ['↑', '↓'], label: 'book.detail.editMetadata.match.keyboard.results' },
  { keys: ['J', 'K'], label: 'book.detail.editMetadata.match.keyboard.fields' },
  { keys: ['Space'], label: 'book.detail.editMetadata.match.keyboard.toggle' },
  { keys: ['/'], label: 'book.detail.editMetadata.match.keyboard.search' },
  { keys: ['Esc'], label: 'book.detail.editMetadata.match.keyboard.close' },
] as const
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <button
        type="button"
        class="hidden size-8 place-items-center rounded-lg text-foreground hover:bg-muted md:grid"
        :aria-label="t('book.detail.editMetadata.match.keyboard.title')"
      >
        <Keyboard class="size-4" aria-hidden="true" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-72 p-3">
      <p class="mb-2 text-[10.5px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
        {{ t('book.detail.editMetadata.match.keyboard.title') }}
      </p>
      <dl class="grid gap-1.5 text-[12.5px]">
        <div v-for="shortcut in SHORTCUTS" :key="shortcut.label" class="flex items-center justify-between gap-3">
          <dt>{{ t(shortcut.label) }}</dt>
          <dd class="flex gap-1">
            <kbd v-for="key in shortcut.keys" :key="key" class="rounded border border-border bg-card px-1.5 font-mono text-[10.5px]">{{ key }}</kbd>
          </dd>
        </div>
      </dl>
    </PopoverContent>
  </Popover>
</template>
