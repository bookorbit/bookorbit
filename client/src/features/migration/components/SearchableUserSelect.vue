<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport,
} from 'reka-ui'
import { Check, ChevronsUpDown } from 'lucide-vue-next'

interface User {
  id: number
  username: string
  name: string
}

const props = defineProps<{
  users: User[]
  modelValue: number | null
  disabled?: boolean
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number | null]
}>()

const searchTerm = ref('')

const filteredUsers = computed(() => {
  const q = searchTerm.value.toLowerCase().trim()
  if (!q) return props.users
  return props.users.filter((u) => `${u.username} ${u.name}`.toLowerCase().includes(q))
})

function normalizeModelValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function handleSelect(value: unknown) {
  emit('update:modelValue', normalizeModelValue(value))
}

function displayValue(value: unknown): string {
  const selectedId = normalizeModelValue(value)
  if (selectedId == null) return ''
  const u = props.users.find((user) => user.id === selectedId)
  if (!u) return ''
  return `${u.username} · ${u.name}`
}
</script>

<template>
  <ComboboxRoot :model-value="modelValue" :ignore-filter="true" :disabled="disabled" @update:model-value="handleSelect">
    <ComboboxAnchor
      class="inline-flex w-full min-w-48 items-center justify-between rounded-md border border-input bg-background text-sm text-foreground transition-colors focus-within:ring-2 focus-within:ring-primary/50 focus-within:border-primary disabled:opacity-50"
    >
      <ComboboxInput
        v-model="searchTerm"
        :display-value="displayValue"
        :placeholder="placeholder ?? 'Select user'"
        class="h-9 w-full bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground/70 disabled:opacity-50"
      />
      <ComboboxTrigger class="shrink-0 px-2 text-muted-foreground">
        <ChevronsUpDown class="size-3.5" />
      </ComboboxTrigger>
    </ComboboxAnchor>

    <ComboboxPortal>
      <ComboboxContent
        position="popper"
        :side-offset="4"
        class="z-[90] max-h-60 w-[var(--reka-combobox-trigger-width)] overflow-hidden rounded-md border border-border bg-popover shadow-md"
      >
        <ComboboxViewport class="p-1">
          <ComboboxEmpty class="px-3 py-2 text-sm text-muted-foreground"> No users found </ComboboxEmpty>
          <ComboboxItem
            v-for="user in filteredUsers"
            :key="user.id"
            :value="user.id"
            class="relative flex cursor-pointer items-center rounded-sm px-3 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
          >
            <ComboboxItemIndicator class="absolute right-2">
              <Check class="size-3.5" />
            </ComboboxItemIndicator>
            <div>
              <span class="font-medium">{{ user.username }}</span>
              <span class="ml-1.5 text-muted-foreground">{{ user.name }}</span>
            </div>
          </ComboboxItem>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
