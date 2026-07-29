<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport,
} from 'reka-ui'
import { Check, ChevronsUpDown, UserRound } from '@lucide/vue'
import type { AuditActorOption } from '@bookorbit/types'

const props = defineProps<{
  actors: AuditActorOption[]
  id: string
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const { t } = useI18n()
const allActorsValue = '__all_actors__'
const open = ref(false)
const searchTerm = ref('')

const filteredActors = computed(() => {
  const query = searchTerm.value.trim().toLocaleLowerCase()
  if (!query) return props.actors
  return props.actors.filter((actor) => `${actor.username} ${actor.userId ?? ''}`.toLocaleLowerCase().includes(query))
})

function handleSelect(value: unknown) {
  emit('update:modelValue', typeof value === 'string' && value !== allActorsValue ? value : '')
}

watch(
  [() => props.modelValue, open],
  ([value, isOpen]) => {
    searchTerm.value = isOpen ? '' : value
  },
  { immediate: true },
)
</script>

<template>
  <ComboboxRoot v-model:open="open" :model-value="props.modelValue" :ignore-filter="true" @update:model-value="handleSelect">
    <ComboboxAnchor
      class="mt-1 inline-flex h-9 w-full items-center rounded-md border border-input bg-background text-sm text-foreground transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/40"
    >
      <UserRound :size="14" class="ms-2.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <ComboboxInput
        :id="props.id"
        v-model="searchTerm"
        :placeholder="t('audit.allActors')"
        class="h-full min-w-0 flex-1 bg-transparent px-2 outline-none placeholder:text-muted-foreground"
      />
      <ComboboxTrigger class="flex h-full shrink-0 items-center px-2.5 text-muted-foreground">
        <ChevronsUpDown :size="14" aria-hidden="true" />
      </ComboboxTrigger>
    </ComboboxAnchor>

    <ComboboxPortal>
      <ComboboxContent
        position="popper"
        :side-offset="4"
        class="z-[90] w-[var(--reka-combobox-trigger-width)] overflow-hidden rounded-md border border-border bg-popover shadow-md"
      >
        <ComboboxViewport class="max-h-60 overflow-y-auto p-1">
          <ComboboxItem
            :value="allActorsValue"
            class="relative flex cursor-pointer items-center rounded-sm px-3 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          >
            <ComboboxItemIndicator class="absolute end-2">
              <Check :size="14" aria-hidden="true" />
            </ComboboxItemIndicator>
            {{ t('audit.allActors') }}
          </ComboboxItem>
          <p v-if="filteredActors.length === 0" class="px-3 py-2 text-sm text-muted-foreground">{{ t('audit.noActorsFound') }}</p>
          <ComboboxItem
            v-for="actor in filteredActors"
            :key="`${actor.userId}-${actor.username}`"
            :value="actor.username"
            class="relative flex cursor-pointer items-center rounded-sm px-3 py-1.5 pe-8 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          >
            <ComboboxItemIndicator class="absolute end-2">
              <Check :size="14" aria-hidden="true" />
            </ComboboxItemIndicator>
            <span class="min-w-0 flex-1 truncate font-medium">{{ actor.username }}</span>
            <span v-if="actor.userId !== null" class="ms-2 shrink-0 text-xs text-muted-foreground">
              {{ t('audit.userIdCompact', { id: actor.userId }) }}
            </span>
          </ComboboxItem>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
