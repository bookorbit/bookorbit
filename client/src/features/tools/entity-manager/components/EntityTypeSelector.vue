<script setup lang="ts">
import { computed, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bookmark, Building2, ChevronDown, Check, Languages, Library, Mic, Tag, Users } from '@lucide/vue'
import { ALL_ENTITY_TYPES, type EntityType } from '@bookorbit/types'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const props = defineProps<{ modelValue: EntityType }>()
const emit = defineEmits<{ 'update:modelValue': [value: EntityType] }>()

const { t } = useI18n()

const icons: Record<EntityType, Component> = {
  author: Users,
  genre: Bookmark,
  tag: Tag,
  narrator: Mic,
  publisher: Building2,
  language: Languages,
  series: Library,
}

const labels = computed<Record<EntityType, string>>(() => ({
  author: t('tools.entityTypes.authors'),
  genre: t('tools.entityTypes.genres'),
  tag: t('tools.entityTypes.tags'),
  narrator: t('tools.entityTypes.narrators'),
  publisher: t('tools.entityTypes.publishers'),
  language: t('tools.entityTypes.languages'),
  series: t('tools.entityTypes.series'),
}))

const activeIcon = computed(() => icons[props.modelValue])
const activeLabel = computed(() => labels.value[props.modelValue])

function handleSelect(value: EntityType): void {
  emit('update:modelValue', value)
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        class="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="t('tools.entityManager.browse.entityTypeLabel')"
      >
        <component :is="activeIcon" :size="15" class="text-muted-foreground" aria-hidden="true" />
        {{ activeLabel }}
        <ChevronDown :size="14" class="text-muted-foreground" aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="min-w-44">
      <DropdownMenuItem v-for="et in ALL_ENTITY_TYPES" :key="et" @click="handleSelect(et)">
        <component :is="icons[et]" :size="15" class="mr-2 text-muted-foreground" aria-hidden="true" />
        {{ labels[et] }}
        <Check v-if="et === modelValue" :size="14" class="ms-auto text-primary" aria-hidden="true" />
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
