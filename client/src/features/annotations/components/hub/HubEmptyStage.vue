<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { BookOpen, Highlighter, Smartphone } from '@lucide/vue'
import { Button } from '@/components/ui/button'

const { t } = useI18n()

const SOURCES = computed(() => [
  { key: 'web', icon: BookOpen, title: t('annotations.hub.empty.readHere'), body: t('annotations.hub.empty.readHereBody') },
  { key: 'kobo', icon: Smartphone, title: t('annotations.hub.empty.syncKobo'), body: t('annotations.hub.empty.syncKoboBody') },
  { key: 'koreader', icon: Smartphone, title: t('annotations.hub.empty.syncKoreader'), body: t('annotations.hub.empty.syncKoreaderBody') },
])
</script>

<template>
  <section class="mx-auto flex w-full max-w-[58rem] flex-col items-center gap-3.5 rounded-xl border border-border bg-card px-6 py-8 text-center">
    <span class="grid size-13 place-items-center rounded-full border border-border bg-muted text-muted-foreground">
      <Highlighter :size="22" />
    </span>
    <div>
      <h2 class="text-[15px] font-bold text-foreground">{{ t('annotations.hub.empty.noAnnotations') }}</h2>
      <p class="mx-auto mt-1.5 max-w-[48ch] text-xs leading-relaxed text-muted-foreground">{{ t('annotations.hub.empty.noAnnotationsBody') }}</p>
    </div>
    <ul class="mt-0.5 grid w-full gap-3 text-left sm:grid-cols-3">
      <li v-for="source in SOURCES" :key="source.key" class="rounded-xl border border-border bg-muted/40 px-3 py-2.5">
        <span class="flex items-center gap-1.5" :style="{ color: `var(--pill-${source.key})` }">
          <component :is="source.icon" :size="13" />
          <b class="text-[11.5px] font-bold text-foreground">{{ source.title }}</b>
        </span>
        <p class="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{{ source.body }}</p>
      </li>
    </ul>
    <Button as-child class="mt-0.5 gap-1.5">
      <RouterLink :to="{ name: 'libraries' }">
        <BookOpen :size="13" />
        {{ t('annotations.hub.empty.goToLibrary') }}
      </RouterLink>
    </Button>
  </section>
</template>
