<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { BookOpen, Highlighter, Smartphone } from '@lucide/vue'

defineProps<{ bookTitle: string; canRead: boolean }>()
const emit = defineEmits<{ read: [] }>()

const { t } = useI18n()

const SOURCES = [
  { key: 'web' as const, icon: BookOpen },
  { key: 'kobo' as const, icon: Smartphone },
  { key: 'koreader' as const, icon: Smartphone },
]

function handleRead() {
  emit('read')
}
</script>

<template>
  <section class="mx-auto mt-8 w-full max-w-[58rem] self-start overflow-hidden rounded-xl border border-border bg-card">
    <div class="flex flex-col items-center gap-3.5 px-6 py-7 text-center">
      <span class="grid size-13 place-items-center rounded-full border border-border bg-muted text-muted-foreground">
        <Highlighter :size="22" />
      </span>
      <div>
        <h2 class="text-[15px] font-bold text-foreground">{{ t('book.detail.highlights.emptyStage.title', { title: bookTitle }) }}</h2>
        <p class="mx-auto mt-1.5 max-w-[46ch] text-xs leading-relaxed text-muted-foreground">{{ t('book.detail.highlights.emptyStage.body') }}</p>
      </div>
      <ul class="mt-0.5 grid w-full gap-3 text-left sm:grid-cols-3">
        <li v-for="source in SOURCES" :key="source.key" class="rounded-xl border border-border bg-muted/40 px-3 py-2.5">
          <p class="flex items-center gap-1.5 text-[11.5px] font-semibold text-foreground" :style="{ color: `var(--pill-${source.key})` }">
            <component :is="source.icon" :size="13" />
            <span class="text-foreground">{{ t(`book.detail.highlights.emptyStage.${source.key}.title`) }}</span>
          </p>
          <p class="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{{ t(`book.detail.highlights.emptyStage.${source.key}.body`) }}</p>
        </li>
      </ul>
      <button
        v-if="canRead"
        type="button"
        class="mt-0.5 inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        @click="handleRead"
      >
        <BookOpen :size="13" />
        {{ t('book.detail.highlights.emptyStage.openReader') }}
      </button>
    </div>
  </section>
</template>
