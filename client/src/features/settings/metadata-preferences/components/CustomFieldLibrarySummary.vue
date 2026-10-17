<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Library as LibraryIcon, TriangleAlert } from '@lucide/vue'
import type { Library } from '@bookorbit/types'
import AppIcon from '@/components/AppIcon.vue'

const props = withDefaults(defineProps<{ libraryIds: number[]; libraries: Library[]; max?: number }>(), { max: 2 })

const { t } = useI18n()

const enabled = computed(() => props.libraries.filter((library) => props.libraryIds.includes(library.id)))
const all = computed(() => props.libraries.length > 0 && enabled.value.length === props.libraries.length)
const shown = computed(() => enabled.value.slice(0, props.max))
const more = computed(() => enabled.value.length - shown.value.length)
const moreTitle = computed(() =>
  enabled.value
    .slice(props.max)
    .map((library) => library.name)
    .join(', '),
)
</script>

<template>
  <span
    v-if="enabled.length === 0"
    class="inline-flex items-center gap-1.5 text-[var(--pill-warning)]"
    :title="t('settings.metadata.customFields.onNoLibraryHint')"
  >
    <TriangleAlert :size="13" aria-hidden="true" />
    <span>{{ t('settings.metadata.customFields.onNoLibrary') }}</span>
  </span>
  <span v-else-if="all" class="inline-flex items-center gap-1.5 text-foreground">
    <LibraryIcon :size="13" class="text-muted-foreground" aria-hidden="true" />
    <span>{{ t('settings.metadata.customFields.allLibraries') }}</span>
  </span>
  <span v-else class="inline-flex min-w-0 items-center gap-2.5">
    <span v-for="library in shown" :key="library.id" class="inline-flex min-w-0 items-center gap-1.5 text-foreground">
      <AppIcon :icon="library.icon" fallback="Library" :size="13" class="shrink-0 text-muted-foreground" aria-hidden="true" />
      <span class="truncate">{{ library.name }}</span>
    </span>
    <span v-if="more > 0" class="shrink-0 rounded-xs bg-foreground/8 px-1 text-xs tabular-nums text-muted-foreground" :title="moreTitle">
      {{ t('settings.metadata.customFields.moreLibraries', { count: more }) }}
    </span>
  </span>
</template>
