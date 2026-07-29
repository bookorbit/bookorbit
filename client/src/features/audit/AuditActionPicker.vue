<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxLabel,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport,
} from 'reka-ui'
import { Check, ChevronsUpDown } from '@lucide/vue'
import { AUDIT_ACTION_OPTIONS, getAuditActionLabelKey } from './audit-actions'
import { getAuditCategory, type AuditCategory } from './audit-display'

const props = defineProps<{
  id: string
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const { t } = useI18n()
const allActionsValue = '__all_actions__'
const open = ref(false)
const searchTerm = ref('')
const categoryOrder: AuditCategory[] = ['authentication', 'books', 'users', 'libraries', 'collections', 'integrations', 'settings', 'other']

const groups = computed(() => {
  const query = searchTerm.value.trim().toLocaleLowerCase()
  return categoryOrder
    .map((category) => ({
      category,
      options: AUDIT_ACTION_OPTIONS.filter((option) => {
        if (getAuditCategory(option.value) !== category) return false
        if (!query) return true
        return `${t(getAuditActionLabelKey(option.value))} ${option.value}`.toLocaleLowerCase().includes(query)
      }),
    }))
    .filter((group) => group.options.length > 0)
})

function handleSelect(value: unknown) {
  emit('update:modelValue', typeof value === 'string' && value !== allActionsValue ? value : '')
}

function displayValue(value: unknown): string {
  return typeof value === 'string' && value ? t(getAuditActionLabelKey(value)) : ''
}

watch(
  [() => props.modelValue, open],
  ([value, isOpen]) => {
    searchTerm.value = isOpen || !value ? '' : t(getAuditActionLabelKey(value))
  },
  { flush: 'post', immediate: true },
)
</script>

<template>
  <ComboboxRoot v-model:open="open" :model-value="props.modelValue" :ignore-filter="true" @update:model-value="handleSelect">
    <ComboboxAnchor
      class="mt-1 inline-flex h-9 w-full items-center rounded-md border border-input bg-background text-sm text-foreground transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/40"
    >
      <ComboboxInput
        :id="props.id"
        v-model="searchTerm"
        :display-value="displayValue"
        :placeholder="t('audit.allEventTypes')"
        class="h-full min-w-0 flex-1 bg-transparent px-2.5 outline-none placeholder:text-muted-foreground"
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
        <ComboboxViewport class="max-h-72 overflow-y-auto p-1">
          <ComboboxItem
            :value="allActionsValue"
            class="relative flex cursor-pointer items-center rounded-sm px-3 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          >
            <ComboboxItemIndicator class="absolute end-2">
              <Check :size="14" aria-hidden="true" />
            </ComboboxItemIndicator>
            {{ t('audit.allEventTypes') }}
          </ComboboxItem>
          <p v-if="groups.length === 0" class="px-3 py-2 text-sm text-muted-foreground">{{ t('audit.noActionsFound') }}</p>
          <ComboboxGroup v-for="group in groups" :key="group.category">
            <ComboboxLabel class="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {{ t(`audit.categories.${group.category}`) }}
            </ComboboxLabel>
            <ComboboxItem
              v-for="option in group.options"
              :key="option.value"
              :value="option.value"
              class="relative flex cursor-pointer items-center rounded-sm px-3 py-1.5 pe-8 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
            >
              <ComboboxItemIndicator class="absolute end-2">
                <Check :size="14" aria-hidden="true" />
              </ComboboxItemIndicator>
              {{ t(getAuditActionLabelKey(option.value)) }}
            </ComboboxItem>
          </ComboboxGroup>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
